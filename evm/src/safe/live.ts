import { Duration, Effect, Layer, Option, Ref } from "effect";
import type { Address, Hash, Hex } from "viem";
import { isAddress, isHash, isHex } from "viem";
import {
  SAFE_EXECUTION_TIMEOUT,
  SAFE_POLL_INTERVAL,
  SAFE_SIGNATURE_POLL_INTERVAL,
  SAFE_SIGNATURE_TIMEOUT,
} from "@/src/constants/index.js";
import { SpanNames } from "@/src/telemetry/index.js";
import { TxManager } from "@/src/tx/index.js";
import type { SafeAppsSdkConfig } from "./adapter.js";
import { loadSafeSdk } from "./adapter.js";
import {
  NotInSafeAppContextError,
  OffchainSignatureTimeoutError,
  SafeInfoUnavailableError,
  SafeSettingsError,
  SafeTxExecutionTimeoutError,
  SafeTxLookupError,
  SafeTxSubmissionError,
  SignTypedDataError,
} from "./errors.js";
import { SafeAppsService } from "./service.js";
import type { EIP712TypedData, SafeInfo, SafeMultisigTx } from "./types.js";

export type SafeAppsServiceConfig = SafeAppsSdkConfig;

/**
 * Validate that a string is a valid Ethereum address, failing with context if not.
 */
const validateAddress = (
  value: string,
  context: string
): Effect.Effect<Address, SafeTxLookupError> =>
  isAddress(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new SafeTxLookupError({
          message: `Invalid address from SDK in ${context}: ${value}`,
          retryable: false,
          safeTxHash: "",
        })
      );

/**
 * Validate that a string is a valid transaction hash, failing with context if not.
 */
const validateHash = (value: string, context: string): Effect.Effect<Hash, SafeTxLookupError> =>
  isHash(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new SafeTxLookupError({
          message: `Invalid hash from SDK in ${context}: ${value}`,
          retryable: false,
          safeTxHash: "",
        })
      );

/**
 * Validate that a string is valid hex, failing with context if not.
 */
const validateHex = (value: string, context: string): Effect.Effect<Hex, SafeTxLookupError> =>
  isHex(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new SafeTxLookupError({
          message: `Invalid hex from SDK in ${context}: ${value}`,
          retryable: false,
          safeTxHash: "",
        })
      );

export const SafeAppsServiceLive = (config?: SafeAppsServiceConfig) =>
  Layer.scoped(
    SafeAppsService,
    Effect.gen(function* () {
      // SSR guard - Safe Apps SDK requires browser environment
      if (typeof window === "undefined") {
        return yield* Effect.fail(
          new NotInSafeAppContextError({
            message: "Safe Apps SDK requires a browser environment (window is undefined)",
          })
        );
      }

      // Load SDK dynamically to keep it optional
      const sdk = yield* loadSafeSdk(config);

      // Cache Safe info after first fetch
      const infoRef = yield* Ref.make<SafeInfo | null>(null);

      // Get TxManager for receipt waiting
      const txManager = yield* TxManager;

      // --- Service method implementations ---

      const getInfo = () =>
        Effect.gen(function* () {
          const cached = yield* Ref.get(infoRef);
          if (cached) {
            return cached;
          }

          const info = yield* Effect.tryPromise({
            catch: (cause) =>
              new SafeInfoUnavailableError({
                cause,
                message: "Failed to get Safe info from SDK",
              }),
            try: () => sdk.safe.getInfo(),
          });

          const safeAddress = yield* validateAddress(info.safeAddress, "getInfo").pipe(
            Effect.catchTag("SafeTxLookupError", (e) =>
              Effect.fail(new SafeInfoUnavailableError({ cause: e, message: e.message }))
            )
          );

          const safeInfo: SafeInfo = {
            chainId: info.chainId,
            safeAddress,
          };

          yield* Ref.set(infoRef, safeInfo);
          return safeInfo;
        }).pipe(Effect.withSpan(SpanNames.SAFE_GET_INFO));

      const sendTxs = (txs: readonly SafeMultisigTx[], params?: { safeTxGas?: number }) =>
        Effect.gen(function* () {
          // Convert bigint values to strings (Safe SDK expects decimal strings)
          const sdkTxs = txs.map((tx) => ({
            data: tx.data,
            to: tx.to,
            value: tx.value?.toString() ?? "0",
          }));

          const result = yield* Effect.tryPromise({
            catch: (cause) =>
              new SafeTxSubmissionError({
                cause,
                message: "Failed to submit txs to Safe",
              }),
            try: () => sdk.txs.send({ params, txs: sdkTxs }),
          });

          const safeTxHash = yield* validateHash(result.safeTxHash, "sendTxs").pipe(
            Effect.catchTag("SafeTxLookupError", (e) =>
              Effect.fail(new SafeTxSubmissionError({ cause: e, message: e.message }))
            )
          );

          const info = yield* getInfo();

          return {
            chainId: info.chainId,
            safeAddress: info.safeAddress,
            safeTxHash,
          };
        })
          .pipe(
            Effect.catchTag("SafeInfoUnavailableError", (error) =>
              Effect.fail(
                new SafeTxSubmissionError({
                  cause: error,
                  message: "Failed to get Safe info after tx submission",
                })
              )
            )
          )
          .pipe(
            Effect.withSpan(SpanNames.SAFE_SEND_TXS, {
              attributes: { txCount: txs.length },
            })
          );

      const getTx = (safeTxHash: Hash) =>
        Effect.gen(function* () {
          const tx = yield* Effect.tryPromise({
            catch: (cause) =>
              new SafeTxLookupError({
                cause,
                message: `Failed to lookup Safe tx ${safeTxHash}`,
                retryable: true,
                safeTxHash,
              }),
            try: () => sdk.txs.getBySafeTxHash(safeTxHash),
          });

          const txHash = tx.txHash ? yield* validateHash(tx.txHash, "getTx") : null;

          return {
            status: tx.txStatus ?? "AWAITING_CONFIRMATIONS",
            txHash: txHash ? Option.some(txHash) : Option.none<Hash>(),
          };
        }).pipe(
          Effect.withSpan(SpanNames.SAFE_GET_TX, {
            attributes: { safeTxHash },
          })
        );

      const waitForTxReceipt = (
        safeTxHash: Hash,
        policy: {
          pollInterval?: number;
          executionTimeout?: number;
          receiptPolicy?: { receiptTimeout?: number; pollingInterval?: number };
        } = {}
      ) =>
        Effect.gen(function* () {
          const info = yield* getInfo();
          const pollInterval = policy.pollInterval ?? SAFE_POLL_INTERVAL;
          const executionTimeout = policy.executionTimeout ?? SAFE_EXECUTION_TIMEOUT;

          // Poll Safe gateway until txHash appears
          // Effect.sleep is interruptible, so this loop respects Effect's interruption model
          const onchainHash = yield* Effect.gen(function* () {
            let lastStatus = "AWAITING_CONFIRMATIONS";
            let found: Hash | null = null;

            const pollEffect = Effect.gen(function* () {
              while (found === null) {
                const tx = yield* getTx(safeTxHash);
                lastStatus = tx.status;

                if (Option.isSome(tx.txHash)) {
                  found = tx.txHash.value;
                } else {
                  // Sleep is interruptible - key for Effect's interruption model
                  yield* Effect.sleep(Duration.millis(pollInterval));
                }
              }
            });

            yield* pollEffect.pipe(
              Effect.timeout(Duration.millis(executionTimeout)),
              Effect.catchTag("TimeoutException", () =>
                Effect.fail(
                  new SafeTxExecutionTimeoutError({
                    lastStatus,
                    message: `Safe tx ${safeTxHash} not executed within ${executionTimeout}ms (last status: ${lastStatus})`,
                    safeTxHash,
                    timeout: executionTimeout,
                  })
                )
              )
            );

            if (found === null) {
              return yield* Effect.fail(
                new SafeTxExecutionTimeoutError({
                  lastStatus,
                  message: `Safe tx ${safeTxHash} not executed within timeout`,
                  safeTxHash,
                  timeout: executionTimeout,
                })
              );
            }
            return found;
          });

          // Delegate to TxManager for on-chain receipt
          const receipt = yield* txManager
            .waitForReceipt(info.chainId, onchainHash, policy.receiptPolicy)
            .pipe(
              Effect.catchTag("TransactionReplacedError", (error) =>
                Effect.fail(
                  new SafeTxLookupError({
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
        })
          .pipe(
            Effect.catchTag("SafeInfoUnavailableError", (error) =>
              Effect.fail(
                new SafeTxLookupError({
                  cause: error,
                  message: "Failed to get Safe info for receipt waiting",
                  retryable: true,
                  safeTxHash,
                })
              )
            )
          )
          .pipe(
            Effect.withSpan(SpanNames.SAFE_WAIT_RECEIPT, {
              attributes: { safeTxHash },
            })
          );

      const signTypedData = (typedData: EIP712TypedData) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            catch: (cause) =>
              new SignTypedDataError({
                cause,
                message: "Failed to sign typed data via Safe",
              }),
            try: () =>
              sdk.txs.signTypedMessage(typedData as Parameters<typeof sdk.txs.signTypedMessage>[0]),
          });

          // SDK returns { safeTxHash } for on-chain or { messageHash } for off-chain
          if ("messageHash" in result && result.messageHash) {
            const messageHash = yield* validateHex(result.messageHash, "signTypedData").pipe(
              Effect.catchTag("SafeTxLookupError", (e) =>
                Effect.fail(new SignTypedDataError({ cause: e, message: e.message }))
              )
            );
            return { _tag: "Offchain" as const, messageHash };
          }

          // Type assertion needed because TypeScript can't narrow SignMessageResponse properly
          const onchainResult = result as { safeTxHash: string };
          const safeTxHash = yield* validateHash(onchainResult.safeTxHash, "signTypedData").pipe(
            Effect.catchTag("SafeTxLookupError", (e) =>
              Effect.fail(new SignTypedDataError({ cause: e, message: e.message }))
            )
          );
          return { _tag: "Onchain" as const, safeTxHash };
        }).pipe(Effect.withSpan(SpanNames.SAFE_SIGN_TYPED_DATA));

      const getOffchainSignature = (messageHash: Hex) =>
        Effect.gen(function* () {
          const sig = yield* Effect.tryPromise({
            catch: (cause) =>
              new SafeTxLookupError({
                cause,
                message: `Failed to get off-chain signature for ${messageHash}`,
                retryable: true,
                safeTxHash: messageHash,
              }),
            try: () => sdk.safe.getOffChainSignature(messageHash),
          });

          // Empty string or "0x" means signature not yet available
          if (!sig || sig === "" || sig === "0x") {
            return Option.none<Hex>();
          }

          const validatedSig = yield* validateHex(sig, "getOffchainSignature");
          return Option.some(validatedSig);
        }).pipe(
          Effect.withSpan(SpanNames.SAFE_GET_OFFCHAIN_SIG, {
            attributes: { messageHash },
          })
        );

      const pollOffchainSignature = (
        messageHash: Hex,
        policy: { pollInterval?: number; timeout?: number } = {}
      ) =>
        Effect.gen(function* () {
          const pollInterval = policy.pollInterval ?? SAFE_SIGNATURE_POLL_INTERVAL;
          const timeout = policy.timeout ?? SAFE_SIGNATURE_TIMEOUT;

          // Poll until we get a signature
          // Effect.sleep is interruptible, so this loop respects Effect's interruption model
          let found: Hex | null = null;

          const pollEffect = Effect.gen(function* () {
            while (found === null) {
              const sig = yield* getOffchainSignature(messageHash);
              if (Option.isSome(sig)) {
                found = sig.value;
              } else {
                // Sleep is interruptible - key for Effect's interruption model
                yield* Effect.sleep(Duration.millis(pollInterval));
              }
            }
          });

          yield* pollEffect.pipe(
            Effect.timeout(Duration.millis(timeout)),
            Effect.catchTag("TimeoutException", () =>
              Effect.fail(
                new OffchainSignatureTimeoutError({
                  message: `Off-chain signature for ${messageHash} not available within ${timeout}ms`,
                  messageHash,
                  timeout,
                })
              )
            )
          );

          if (found === null) {
            return yield* Effect.fail(
              new OffchainSignatureTimeoutError({
                message: `Off-chain signature for ${messageHash} not available within timeout`,
                messageHash,
                timeout,
              })
            );
          }

          return { messageHash, signature: found };
        }).pipe(
          Effect.withSpan(SpanNames.SAFE_POLL_OFFCHAIN_SIG, {
            attributes: { messageHash },
          })
        );

      const enableOffchainSigning = () =>
        Effect.tryPromise({
          catch: (cause) =>
            new SafeSettingsError({
              cause,
              message: "Failed to enable off-chain signing mode",
            }),
          try: () => sdk.eth.setSafeSettings([{ offChainSigning: true }]),
        })
          .pipe(Effect.asVoid)
          .pipe(Effect.withSpan(SpanNames.SAFE_ENABLE_OFFCHAIN));

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
