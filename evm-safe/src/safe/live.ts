import { isUserRejectedError, UserRejectedError } from "@prb/effect-evm/core/errors";
import { TxManager } from "@prb/effect-evm/tx";
import { Duration, Effect, Layer, Option, Ref } from "effect";
import type { Hash, Hex } from "viem";
import { isAddress, isHash, isHex } from "viem";
import {
  SAFE_EXECUTION_TIMEOUT,
  SAFE_POLL_INTERVAL,
  SAFE_SIGNATURE_POLL_INTERVAL,
  SAFE_SIGNATURE_TIMEOUT,
} from "#src/constants/index.js";
import type { SafeAppsSDKInstance, SafeAppsSdkConfig } from "./adapter.js";
import { loadSafeSdk } from "./adapter.js";
import type { SafeAppsSdkUnavailableError } from "./errors.js";
import {
  getSafeErrorMessage,
  NotInSafeAppContextError,
  OffchainSignatureTimeoutError,
  SafeMultisigInfoUnavailableError,
  SafeMultisigSettingsError,
  SafeMultisigTxExecutionTimeoutError,
  SafeMultisigTxLookupError,
  SafeMultisigTxSubmissionError,
  SignTypedDataError,
  toSafeMultisigTxLookupError,
} from "./errors.js";
import { pollUntil } from "./internal/poll.js";
import { SafeAppsService } from "./service.js";
import type { EIP712TypedData, SafeMultisigInfo, SafeMultisigTx } from "./types.js";

export type SafeAppsServiceConfig = SafeAppsSdkConfig & {
  /**
   * Timeout (ms) for the `getInfo` SDK call. The Safe Apps communicator never settles when the
   * page is embedded in a non-Safe parent (the response is discarded by the SDK's own
   * `isValidMessage` filter), so without a timeout `getInfo` would hang forever. Defaults to
   * {@link DEFAULT_GET_INFO_TIMEOUT}. Only `getInfo` is bounded — `sendTxs` / signature calls
   * legitimately block on user interaction in the Safe UI.
   */
  readonly getInfoTimeout?: Duration.DurationInput;
};

/** Default timeout for the `getInfo` SDK round-trip (see {@link SafeAppsServiceConfig}). */
const DEFAULT_GET_INFO_TIMEOUT = Duration.seconds(5);

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

/**
 * Internal SDK state for lazy loading. Only the `loaded` state is cached: SSR/iframe-guard and
 * transient dynamic-import failures must stay retryable across hydration / network recovery, so
 * failures are surfaced without being written to the ref.
 */
type SdkState<T> = { readonly _tag: "pending" } | { readonly _tag: "loaded"; readonly sdk: T };

// --- SDK Wrapper Helper ---

const withSdk = <A, E>(
  getSdk: Effect.Effect<SafeAppsSDKInstance, SdkUnavailableError>,
  fn: (sdk: SafeAppsSDKInstance) => Effect.Effect<A, E>,
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

      const sdkRef = yield* Ref.make<SdkState<SafeAppsSDKInstance>>({ _tag: "pending" });

      const getInfoTimeout = Duration.decode(config?.getInfoTimeout ?? DEFAULT_GET_INFO_TIMEOUT);

      /** Get SDK, loading lazily on first call. Fails if not in Safe App context. */
      const getSdk: Effect.Effect<SafeAppsSDKInstance, SdkUnavailableError> = Effect.gen(
        function* () {
          const state = yield* Ref.get(sdkRef);

          if (state._tag === "loaded") {
            return state.sdk;
          }

          // SSR guard — no cache: hydration may make `window` available on a later call.
          if (typeof window === "undefined") {
            return yield* Effect.fail(
              new NotInSafeAppContextError({
                message: "Safe Apps SDK requires a browser environment (window is undefined)",
              })
            );
          }

          // Safe iframe guard — no cache: the embedding context is environmental and the check is
          // cheap. `safe-apps-sdk`'s communicator postMessages to `window.parent`; in a top-level
          // window the request echoes back to the same window and is discarded by the SDK's own
          // `isValidMessage` filter, so the response promise never settles. Fail fast instead.
          if (window.parent === window) {
            return yield* Effect.fail(
              new NotInSafeAppContextError({
                message: "Safe Apps SDK requires the page to be embedded in a Safe App host",
              })
            );
          }

          // Cache only the loaded SDK. Dynamic imports are memoized by the bundler, so a transient
          // load failure (e.g. chunk-load error) costs nothing to retry on the next call.
          const sdk = yield* loadSafeSdk(config);
          yield* Ref.set(sdkRef, { _tag: "loaded", sdk });
          return sdk;
        }
      );

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
              try: () => s.safe.getInfo(),
            }).pipe(
              // The iframe guard in `getSdk` blocks top-level windows, but an embedded-in-non-Safe
              // parent passes that guard yet never responds (the SDK's `isValidMessage` filter
              // drops the echoed message). Bound the round-trip so `getInfo` fails instead of
              // hanging. `sendTxs` / signature calls are intentionally left unbounded — they block
              // on user interaction in the Safe UI.
              Effect.timeoutFail({
                duration: getInfoTimeout,
                onTimeout: () =>
                  new SafeMultisigInfoUnavailableError({
                    message: `Safe getInfo timed out after ${Duration.toMillis(getInfoTimeout)}ms (not embedded in a responsive Safe App host)`,
                  }),
              })
            ),
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
              catch: (cause) => {
                if (isUserRejectedError(cause)) {
                  return new UserRejectedError({ message: "User rejected the Safe transaction" });
                }
                const detail = getSafeErrorMessage(cause);
                return new SafeMultisigTxSubmissionError({
                  cause,
                  message: detail
                    ? `Failed to submit txs to Safe: ${detail}`
                    : "Failed to submit txs to Safe",
                });
              },
              try: () => s.txs.send({ params, txs: sdkTxs }),
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
              catch: (cause) => toSafeMultisigTxLookupError(safeTxHash, cause, true),
              try: () => s.txs.getBySafeTxHash(safeTxHash),
            }),
          (e) => toSafeMultisigTxLookupError(safeTxHash, e, false)
        );

        const txHash = tx.txHash ? yield* validateHash(tx.txHash, "getTx") : null;
        const executionInfo = tx.detailedExecutionInfo;
        const hasMultisigExecutionInfo =
          executionInfo !== undefined &&
          executionInfo !== null &&
          executionInfo.type === "MULTISIG";

        return {
          confirmations: hasMultisigExecutionInfo ? executionInfo.confirmations.length : null,
          confirmationsRequired: hasMultisigExecutionInfo
            ? executionInfo.confirmationsRequired
            : null,
          onchainHash: txHash ? Option.some(txHash) : Option.none<Hash>(),
          status: tx.txStatus ?? "AWAITING_CONFIRMATIONS",
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
            Effect.fail(toSafeMultisigTxLookupError(safeTxHash, error, true))
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
            return tx.onchainHash;
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
              Effect.fail(toSafeMultisigTxLookupError(safeTxHash, error, false))
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
              catch: (cause) => {
                if (isUserRejectedError(cause)) {
                  return new UserRejectedError({ message: "User rejected Safe signature" });
                }
                return new SignTypedDataError({
                  cause,
                  message: "Failed to sign typed data via Safe",
                });
              },
              try: () => s.txs.signTypedMessage(typedData),
            }),
          (e) => new SignTypedDataError({ cause: e, message: e.message })
        );

        // SDK returns { safeTxHash } for on-chain or { messageHash } for off-chain
        if ("messageHash" in result) {
          const messageHash = yield* validateHex(result.messageHash ?? "", "signTypedData").pipe(
            Effect.catchTag("SafeMultisigTxLookupError", (e) =>
              Effect.fail(new SignTypedDataError({ cause: e, message: e.message }))
            )
          );
          return { _tag: "Offchain" as const, messageHash };
        }

        const safeTxHash = yield* validateHash(result.safeTxHash, "signTypedData").pipe(
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
              catch: (cause) => toSafeMultisigTxLookupError(messageHash, cause, true),
              try: () => s.safe.getOffChainSignature(messageHash),
            }),
          (e) => toSafeMultisigTxLookupError(messageHash, e, false)
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
                try: () => s.eth.setSafeSettings([{ offChainSigning: true }]),
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
