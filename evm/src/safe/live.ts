import { Effect, Layer, Option, Ref } from "effect";
import type { Hash, Hex } from "viem";
import { isAddress, isHash, isHex } from "viem";
import {
  SAFE_EXECUTION_TIMEOUT,
  SAFE_POLL_INTERVAL,
  SAFE_SIGNATURE_POLL_INTERVAL,
  SAFE_SIGNATURE_TIMEOUT,
} from "@/src/constants/index.js";
import { TxManager } from "@/src/tx/index.js";
import type { SafeAppsSdkConfig } from "./adapter.js";
import { loadSafeSdk } from "./adapter.js";
import type { SafeAppsSdkUnavailableError } from "./errors.js";
import {
  NotInSafeAppContextError,
  OffchainSignatureTimeoutError,
  SafeMultisigInfoUnavailableError,
  SafeMultisigSettingsError,
  SafeMultisigTxExecutionTimeoutError,
  SafeMultisigTxLookupError,
  SafeMultisigTxSubmissionError,
  SignTypedDataError,
} from "./errors.js";
import { pollUntil } from "./internal/poll.js";
import { SafeAppsService } from "./service.js";
import type { EIP712TypedData, SafeMultisigInfo, SafeMultisigTx } from "./types.js";

export type SafeAppsServiceConfig = SafeAppsSdkConfig;

// --- SDK Response Types (internal - SDK is optional dependency) ---

type SdkMultisigInfo = { chainId: number; safeAddress: string };
type SdkTxSendResult = { safeTxHash: string };
type SdkTxDetails = { txHash?: string; txStatus?: string };
type SdkSignResult = { messageHash?: string; safeTxHash?: string };

// --- Validation Factory ---

type Predicate<T extends string> = (value: string) => value is T;

const makeValidator =
  <T extends string>(predicate: Predicate<T>, label: string) =>
  (value: string, context: string): Effect.Effect<T, SafeMultisigTxLookupError> =>
    predicate(value)
      ? Effect.succeed(value)
      : Effect.fail(
          new SafeMultisigTxLookupError({
            message: `Invalid ${label} from SDK in ${context}: ${value}`,
            retryable: false,
            safeTxHash: "",
          })
        );

const validateAddress = makeValidator(isAddress, "address");
const validateHash = makeValidator(isHash, "hash");
const validateHex = makeValidator(isHex, "hex");

// --- SDK State ---

/** SDK availability error - either SSR environment or SDK load failure */
type SdkUnavailableError = NotInSafeAppContextError | SafeAppsSdkUnavailableError;

/** Internal SDK state for lazy loading */
type SdkState<T> =
  | { readonly _tag: "pending" }
  | { readonly _tag: "loaded"; readonly sdk: T }
  | { readonly _tag: "unavailable"; readonly error: SdkUnavailableError };

// --- SDK Wrapper Helper ---

const withSdk = <A, E>(
  getSdk: Effect.Effect<unknown, SdkUnavailableError>,
  fn: (sdk: unknown) => Effect.Effect<A, E>,
  mapError: (e: SdkUnavailableError) => E
): Effect.Effect<A, E> => Effect.flatMap(Effect.mapError(getSdk, mapError), fn);

// --- Service Implementation ---

export const SafeAppsServiceLive = (config?: SafeAppsServiceConfig) =>
  Layer.scoped(
    SafeAppsService,
    Effect.gen(function* () {
      // Cache Safe info after first fetch
      const infoRef = yield* Ref.make<SafeMultisigInfo | null>(null);

      // Get TxManager for receipt waiting
      const txManager = yield* TxManager;

      // biome-ignore lint/suspicious/noExplicitAny: SDK is optional dependency with dynamic types
      const sdkRef = yield* Ref.make<SdkState<any>>({ _tag: "pending" });

      /** Get SDK, loading lazily on first call. Fails if not in Safe App context. */
      const getSdk: Effect.Effect<unknown, SdkUnavailableError> = Effect.gen(function* () {
        const state = yield* Ref.get(sdkRef);

        if (state._tag === "loaded") {
          return state.sdk;
        }
        if (state._tag === "unavailable") {
          return yield* Effect.fail(state.error);
        }

        // First call - check environment and load SDK
        if (typeof window === "undefined") {
          const error = new NotInSafeAppContextError({
            message: "Safe Apps SDK requires a browser environment (window is undefined)",
          });
          yield* Ref.set(sdkRef, { _tag: "unavailable", error });
          return yield* Effect.fail(error);
        }

        // Try to load SDK - catch SDK unavailable error and store it
        const loadResult = yield* loadSafeSdk(config).pipe(
          Effect.map((sdk) => ({ _tag: "loaded" as const, sdk })),
          Effect.catchTag("SafeAppsSdkUnavailableError", (error) =>
            Effect.succeed({ _tag: "unavailable" as const, error } as const)
          )
        );

        yield* Ref.set(sdkRef, loadResult);

        if (loadResult._tag === "unavailable") {
          return yield* Effect.fail(loadResult.error);
        }

        return loadResult.sdk;
      });

      // --- Service Methods ---

      const getInfo = Effect.fn("SafeAppsService.getInfo")(function* () {
        const cached = yield* Ref.get(infoRef);
        if (cached) {
          return cached;
        }

        const sdk = yield* withSdk(
          getSdk,
          (s) =>
            Effect.tryPromise({
              catch: (cause) =>
                new SafeMultisigInfoUnavailableError({
                  cause,
                  message: "Failed to get Safe info from SDK",
                }),
              try: () =>
                (s as { safe: { getInfo: () => Promise<SdkMultisigInfo> } }).safe.getInfo(),
            }),
          (e) => new SafeMultisigInfoUnavailableError({ cause: e, message: e.message })
        );

        const safeAddress = yield* validateAddress(sdk.safeAddress, "getInfo").pipe(
          Effect.catchTag("SafeMultisigTxLookupError", (e) =>
            Effect.fail(new SafeMultisigInfoUnavailableError({ cause: e, message: e.message }))
          )
        );

        const safeInfo: SafeMultisigInfo = { chainId: sdk.chainId, safeAddress };
        yield* Ref.set(infoRef, safeInfo);
        return safeInfo;
      });

      const sendTxs = Effect.fn("SafeAppsService.sendTxs")(function* (
        txs: readonly SafeMultisigTx[],
        params?: { safeTxGas?: number }
      ) {
        // Convert bigint values to strings (Safe SDK expects decimal strings)
        const sdkTxs = txs.map((tx) => ({
          data: tx.data,
          to: tx.to,
          value: tx.value?.toString() ?? "0",
        }));

        const result = yield* withSdk(
          getSdk,
          (s) =>
            Effect.tryPromise({
              catch: (cause) =>
                new SafeMultisigTxSubmissionError({
                  cause,
                  message: "Failed to submit txs to Safe",
                }),
              try: () =>
                (
                  s as {
                    txs: {
                      send: (opts: {
                        params?: unknown;
                        txs: unknown[];
                      }) => Promise<SdkTxSendResult>;
                    };
                  }
                ).txs.send({ params, txs: sdkTxs }),
            }),
          (e) => new SafeMultisigTxSubmissionError({ cause: e, message: e.message })
        );

        const safeTxHash = yield* validateHash(result.safeTxHash, "sendTxs").pipe(
          Effect.catchTag("SafeMultisigTxLookupError", (e) =>
            Effect.fail(new SafeMultisigTxSubmissionError({ cause: e, message: e.message }))
          )
        );

        const info = yield* getInfo().pipe(
          Effect.catchTag("SafeMultisigInfoUnavailableError", (error) =>
            Effect.fail(
              new SafeMultisigTxSubmissionError({
                cause: error,
                message: "Failed to get Safe info after tx submission",
              })
            )
          )
        );

        return { chainId: info.chainId, safeAddress: info.safeAddress, safeTxHash };
      });

      const getTx = Effect.fn("SafeAppsService.getTx")(function* (safeTxHash: Hash) {
        const tx = yield* withSdk(
          getSdk,
          (s) =>
            Effect.tryPromise({
              catch: (cause) =>
                new SafeMultisigTxLookupError({
                  cause,
                  message: `Failed to lookup Safe tx ${safeTxHash}`,
                  retryable: true,
                  safeTxHash,
                }),
              try: () =>
                (
                  s as { txs: { getBySafeTxHash: (hash: string) => Promise<SdkTxDetails> } }
                ).txs.getBySafeTxHash(safeTxHash),
            }),
          (e) =>
            new SafeMultisigTxLookupError({
              cause: e,
              message: e.message,
              retryable: false,
              safeTxHash,
            })
        );

        const txHash = tx.txHash ? yield* validateHash(tx.txHash, "getTx") : null;

        return {
          status: tx.txStatus ?? "AWAITING_CONFIRMATIONS",
          txHash: txHash ? Option.some(txHash) : Option.none<Hash>(),
        };
      });

      const waitForTxReceipt = Effect.fn("SafeAppsService.waitForTxReceipt")(function* (
        safeTxHash: Hash,
        policy: {
          pollInterval?: number;
          executionTimeout?: number;
          receiptPolicy?: { receiptTimeout?: number; pollingInterval?: number };
        } = {}
      ) {
        const info = yield* getInfo().pipe(
          Effect.catchTag("SafeMultisigInfoUnavailableError", (error) =>
            Effect.fail(
              new SafeMultisigTxLookupError({
                cause: error,
                message: "Failed to get Safe info for receipt waiting",
                retryable: true,
                safeTxHash,
              })
            )
          )
        );

        const pollInterval = policy.pollInterval ?? SAFE_POLL_INTERVAL;
        const executionTimeout = policy.executionTimeout ?? SAFE_EXECUTION_TIMEOUT;

        // Track last status for timeout error message
        let lastStatus = "AWAITING_CONFIRMATIONS";

        const onchainHash = yield* pollUntil(
          Effect.gen(function* () {
            const tx = yield* getTx(safeTxHash);
            lastStatus = tx.status;
            return tx.txHash;
          }),
          { interval: pollInterval, timeout: executionTimeout },
          (timeout) =>
            new SafeMultisigTxExecutionTimeoutError({
              lastStatus,
              message: `Safe tx ${safeTxHash} not executed within ${timeout}ms (last status: ${lastStatus})`,
              safeTxHash,
              timeout,
            })
        );

        // Delegate to TxManager for on-chain receipt
        const receipt = yield* txManager
          .waitForReceipt(info.chainId, onchainHash, policy.receiptPolicy)
          .pipe(
            Effect.catchTag("TxReplacedError", (error) =>
              Effect.fail(
                new SafeMultisigTxLookupError({
                  cause: error,
                  message: `Transaction was replaced: ${error.message}`,
                  retryable: false,
                  safeTxHash,
                })
              )
            )
          );

        return {
          chainId: info.chainId,
          onchainHash,
          receipt,
          safeAddress: info.safeAddress,
          safeTxHash,
        };
      });

      const signTypedData = Effect.fn("SafeAppsService.signTypedData")(function* (
        typedData: EIP712TypedData
      ) {
        const result = yield* withSdk(
          getSdk,
          (s) =>
            Effect.tryPromise({
              catch: (cause) =>
                new SignTypedDataError({ cause, message: "Failed to sign typed data via Safe" }),
              try: () =>
                (
                  s as { txs: { signTypedMessage: (data: unknown) => Promise<SdkSignResult> } }
                ).txs.signTypedMessage(typedData),
            }),
          (e) => new SignTypedDataError({ cause: e, message: e.message })
        );

        // SDK returns { safeTxHash } for on-chain or { messageHash } for off-chain
        if ("messageHash" in result && result.messageHash) {
          const messageHash = yield* validateHex(result.messageHash, "signTypedData").pipe(
            Effect.catchTag("SafeMultisigTxLookupError", (e) =>
              Effect.fail(new SignTypedDataError({ cause: e, message: e.message }))
            )
          );
          return { _tag: "Offchain" as const, messageHash };
        }

        const safeTxHash = yield* validateHash(result.safeTxHash ?? "", "signTypedData").pipe(
          Effect.catchTag("SafeMultisigTxLookupError", (e) =>
            Effect.fail(new SignTypedDataError({ cause: e, message: e.message }))
          )
        );
        return { _tag: "Onchain" as const, safeTxHash };
      });

      const getOffchainSignature = Effect.fn("SafeAppsService.getOffchainSignature")(function* (
        messageHash: Hex
      ) {
        const sig = yield* withSdk(
          getSdk,
          (s) =>
            Effect.tryPromise({
              catch: (cause) =>
                new SafeMultisigTxLookupError({
                  cause,
                  message: `Failed to get off-chain signature for ${messageHash}`,
                  retryable: true,
                  safeTxHash: messageHash,
                }),
              try: () =>
                (
                  s as { safe: { getOffChainSignature: (hash: string) => Promise<string> } }
                ).safe.getOffChainSignature(messageHash),
            }),
          (e) =>
            new SafeMultisigTxLookupError({
              cause: e,
              message: e.message,
              retryable: false,
              safeTxHash: messageHash,
            })
        );

        // Empty string or "0x" means signature not yet available
        if (!sig || sig === "" || sig === "0x") {
          return Option.none<Hex>();
        }

        const validatedSig = yield* validateHex(sig, "getOffchainSignature");
        return Option.some(validatedSig);
      });

      const pollOffchainSignature = Effect.fn("SafeAppsService.pollOffchainSignature")(function* (
        messageHash: Hex,
        policy: { pollInterval?: number; timeout?: number } = {}
      ) {
        const pollInterval = policy.pollInterval ?? SAFE_SIGNATURE_POLL_INTERVAL;
        const timeout = policy.timeout ?? SAFE_SIGNATURE_TIMEOUT;

        const signature = yield* pollUntil(
          getOffchainSignature(messageHash),
          { interval: pollInterval, timeout },
          (elapsed) =>
            new OffchainSignatureTimeoutError({
              message: `Off-chain signature for ${messageHash} not available within ${elapsed}ms`,
              messageHash,
              timeout: elapsed,
            })
        );

        return { messageHash, signature };
      });

      const enableOffchainSigning = Effect.fn("SafeAppsService.enableOffchainSigning")(
        function* () {
          yield* withSdk(
            getSdk,
            (s) =>
              Effect.tryPromise({
                catch: (cause) =>
                  new SafeMultisigSettingsError({
                    cause,
                    message: "Failed to enable off-chain signing mode",
                  }),
                try: () =>
                  (
                    s as { eth: { setSafeSettings: (settings: unknown[]) => Promise<void> } }
                  ).eth.setSafeSettings([{ offChainSigning: true }]),
              }),
            (e) => new SafeMultisigSettingsError({ cause: e, message: e.message })
          );
        }
      );

      return SafeAppsService.of({
        enableOffchainSigning,
        getInfo,
        getOffchainSignature,
        getTx,
        pollOffchainSignature,
        sendTxs,
        signTypedData,
        waitForTxReceipt,
      });
    })
  );
