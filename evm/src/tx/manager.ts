import type { Scope, SubscriptionRef } from "effect";
import { Clock, Context, Duration, Effect, Fiber, Layer, Ref, Stream } from "effect";
import type { Hash, TransactionReceipt } from "viem";
import { WaitForTransactionReceiptTimeoutError } from "viem";
import { DEFAULT_RECEIPT_TIMEOUT, DEFAULT_STUCK_TX_MS } from "@/src/constants/index.js";
import type { ClientNotFoundError, TxReplacementReason } from "@/src/core/index.js";
import {
  PublicClientService,
  ReceiptTimeoutError,
  TransportError,
  TxFailedError,
  TxReplacedError,
} from "@/src/core/index.js";
import { SpanNames } from "@/src/telemetry/index.js";
import { makeReceiptRetrySchedule } from "./internal/receipt-retry.js";
import type { TxPolicy } from "./policy.js";
import { defaultPolicy } from "./policy.js";
import { TxReplacement } from "./replacement.js";
import type { TxState } from "./tracker.js";
import { makeTxTracker } from "./tracker.js";

export type TxManagerShape = {
  /**
   * Track an existing transaction hash and return a SubscriptionRef for state updates
   */
  readonly track: (
    chainId: number,
    hash: Hash,
    policy?: TxPolicy
  ) => Effect.Effect<SubscriptionRef.SubscriptionRef<TxState>, ClientNotFoundError, Scope.Scope>;

  /**
   * Wait for transaction receipt with timeout
   */
  readonly waitForReceipt: (
    chainId: number,
    hash: Hash,
    timeoutOrPolicy?: number | TxPolicy
  ) => Effect.Effect<
    TransactionReceipt,
    TxFailedError | ReceiptTimeoutError | TxReplacedError | ClientNotFoundError
  >;

  /**
   * Get the number of confirmations for a transaction
   */
  readonly getConfirmations: (
    chainId: number,
    params: { hash: Hash } | { transactionReceipt: TransactionReceipt }
  ) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;
};

export class TxManager extends Context.Tag("ew3/TxManager")<TxManager, TxManagerShape>() {}

export function makeTxManagerLive(
  layerPolicy?: TxPolicy
): Layer.Layer<TxManager, never, PublicClientService | TxReplacement> {
  const layerDefault: TxPolicy = {
    ...defaultPolicy,
    ...layerPolicy,
    replacement: {
      ...(defaultPolicy.replacement ?? {}),
      ...(layerPolicy?.replacement ?? {}),
    },
  };

  return Layer.effect(
    TxManager,
    Effect.gen(function* () {
      const publicClientService = yield* PublicClientService;
      const txReplacement = yield* TxReplacement;

      return {
        getConfirmations: Effect.fn("TxManager.getConfirmations")(function* (chainId, params) {
          const client = yield* publicClientService.get(chainId);

          return yield* Effect.tryPromise({
            catch: (cause) =>
              new TransportError({
                cause,
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Failed to get transaction confirmations",
                url: client.transport.url ?? "",
              }),
            try: () => client.getTransactionConfirmations(params),
          }).pipe(
            Effect.withSpan(SpanNames.TX_GET_CONFIRMATIONS, {
              attributes: {
                chainId,
                hash: "hash" in params ? params.hash : params.transactionReceipt.transactionHash,
              },
            })
          );
        }),
        track: Effect.fn("TxManager.track")(function* (chainId, hash, providedPolicy) {
          const tracker = yield* makeTxTracker;
          const client = yield* publicClientService.get(chainId);
          const policy: TxPolicy = {
            ...layerDefault,
            ...providedPolicy,
            replacement: {
              ...(layerDefault.replacement ?? {}),
              ...(providedPolicy?.replacement ?? {}),
            },
          };

          // Set initial state
          yield* tracker.set({ hash, status: "submitted" });

          // Start tracking in background
          yield* Effect.forkScoped(
            // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: tracking orchestration is inherently complex
            Effect.gen(function* () {
              const currentHashRef = yield* Ref.make<Hash>(hash);
              const confirmationsRef = yield* Ref.make(0);
              const startedAtMsRef = yield* Ref.make(yield* Clock.currentTimeMillis);
              const autoAttemptsRef = yield* Ref.make(0);
              const autoReplacingRef = yield* Ref.make(false);

              const replacementStrategy =
                policy.replacement?.strategy ?? policy.replacementStrategy ?? "none";
              const stuckMs = policy.replacement?.stuckMs ?? DEFAULT_STUCK_TX_MS;
              const maxAttempts = policy.replacement?.maxAttempts ?? 1;

              const updatePendingState = (currentHash: Hash) =>
                Effect.gen(function* () {
                  const confirmations = yield* Ref.modify(
                    confirmationsRef,
                    (n) => [n + 1, n + 1] as const
                  );

                  yield* tracker.set({
                    confirmations,
                    hash: currentHash,
                    status: "pending",
                  });
                  return confirmations;
                });

              const performAutoReplacement = (currentHash: Hash, now: number) =>
                Ref.set(autoReplacingRef, true).pipe(
                  Effect.zipRight(
                    (replacementStrategy === "cancel"
                      ? txReplacement.cancel(chainId, currentHash, policy)
                      : txReplacement.speedup(chainId, currentHash, policy)
                    ).pipe(
                      Effect.either,
                      Effect.ensuring(Ref.set(autoReplacingRef, false)),
                      Effect.flatMap((replaced) => {
                        if (replaced._tag === "Left") {
                          return Effect.void;
                        }

                        const newHash = replaced.right;
                        return Effect.all([
                          Ref.set(currentHashRef, newHash),
                          Ref.set(confirmationsRef, 0),
                          Ref.set(startedAtMsRef, now),
                          Ref.update(autoAttemptsRef, (n) => n + 1),
                          tracker.set({
                            newHash,
                            oldHash: currentHash,
                            reason: replacementStrategy === "cancel" ? "cancelled" : "repriced",
                            status: "replaced",
                          }),
                          tracker.set({ hash: newHash, status: "submitted" }),
                        ]).pipe(Effect.asVoid);
                      })
                    )
                  )
                );

              const autoReplaceIfStuck = (currentHash: Hash) => {
                if (replacementStrategy === "none") {
                  return Effect.void;
                }

                return Effect.all({
                  alreadyReplacing: Ref.get(autoReplacingRef),
                  attempts: Ref.get(autoAttemptsRef),
                  now: Clock.currentTimeMillis,
                  startedAt: Ref.get(startedAtMsRef),
                }).pipe(
                  Effect.flatMap(({ alreadyReplacing, attempts, now, startedAt }) => {
                    const elapsed = startedAt > 0 ? now - startedAt : 0;
                    const stuck = elapsed >= stuckMs;
                    const allowed = attempts < maxAttempts && !alreadyReplacing;
                    return stuck && allowed
                      ? performAutoReplacement(currentHash, now)
                      : Effect.void;
                  })
                );
              };

              const onPendingBlock = Effect.gen(function* () {
                const currentHash = yield* Ref.get(currentHashRef);
                yield* updatePendingState(currentHash);
                yield* autoReplaceIfStuck(currentHash);
              });

              const pendingFiber = yield* Stream.runForEach(
                Stream.async<bigint, unknown>((emit) => {
                  const unwatch = client.watchBlockNumber({
                    onBlockNumber: (blockNumber: bigint) => emit.single(blockNumber),
                    onError: (error) => emit.fail(error as unknown),
                    pollingInterval: policy.pollingInterval,
                  });

                  return Effect.sync(() => {
                    unwatch();
                  });
                }),
                () => onPendingBlock
              ).pipe(Effect.forkScoped);

              let replacement:
                | {
                    oldHash: Hash;
                    newHash: Hash;
                    reason: TxReplacementReason;
                  }
                | undefined;

              const receiptResult = yield* Effect.either(
                Effect.tryPromise({
                  catch: (e) => e,
                  try: () =>
                    client.waitForTransactionReceipt({
                      hash,
                      onReplaced: (info) => {
                        replacement = {
                          newHash: info.transaction.hash,
                          oldHash: info.replacedTransaction.hash,
                          reason: info.reason,
                        };
                      },
                      pollingInterval: policy.pollingInterval,
                      timeout: policy.receiptTimeout,
                    }),
                })
              ).pipe(Effect.ensuring(Fiber.interrupt(pendingFiber)));

              if (receiptResult._tag === "Left") {
                const cause = receiptResult.left;
                const timeout = policy.receiptTimeout ?? DEFAULT_RECEIPT_TIMEOUT;

                const failure =
                  cause instanceof WaitForTransactionReceiptTimeoutError
                    ? new ReceiptTimeoutError({
                        hash,
                        message: cause.message,
                        timeout,
                      })
                    : cause;

                yield* tracker.set({
                  error: new TxFailedError({
                    cause: failure,
                    hash,
                    message: failure instanceof Error ? failure.message : String(failure),
                  }),
                  status: "failed",
                });

                return;
              }

              const receipt = receiptResult.right;

              if (replacement) {
                yield* Ref.set(currentHashRef, replacement.newHash);
                yield* tracker.set({
                  newHash: replacement.newHash,
                  oldHash: replacement.oldHash,
                  reason: replacement.reason,
                  status: "replaced",
                });
                yield* tracker.set({
                  hash: replacement.newHash,
                  status: "submitted",
                });
              }

              yield* tracker.set({
                effectiveGasPrice: receipt.effectiveGasPrice,
                hash: receipt.transactionHash,
                receipt,
                status: "mined",
              });
            })
          );

          return tracker.ref;
        }),

        waitForReceipt: Effect.fn("TxManager.waitForReceipt")(
          function* (chainId, hash, timeoutOrPolicy) {
            const client = yield* publicClientService.get(chainId);
            const policy =
              typeof timeoutOrPolicy === "object" && timeoutOrPolicy !== null
                ? timeoutOrPolicy
                : undefined;
            const timeout =
              typeof timeoutOrPolicy === "number"
                ? timeoutOrPolicy
                : (policy?.receiptTimeout ??
                  layerDefault.receiptTimeout ??
                  DEFAULT_RECEIPT_TIMEOUT);
            const pollingInterval = policy?.pollingInterval ?? layerDefault.pollingInterval;
            const start = yield* Clock.currentTimeMillis;
            const makeReceiptTimeoutError = () =>
              new ReceiptTimeoutError({
                hash,
                message: `Receipt timeout exceeded (${timeout}ms)`,
                timeout,
              });

            const waitForReceiptAttempt = Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              const remaining = timeout - (now - start);

              if (remaining <= 0) {
                return yield* Effect.fail(makeReceiptTimeoutError());
              }

              return yield* Effect.tryPromise({
                catch: (cause) => {
                  if (cause instanceof TxReplacedError) {
                    return cause;
                  }

                  return new TxFailedError({
                    cause,
                    hash,
                    message: `Failed to get receipt for ${hash}`,
                  });
                },
                try: async () => {
                  let replacement: { newHash: Hash; reason: TxReplacementReason } | undefined;

                  // Pass remaining budget to viem to cancel underlying poll on timeout
                  const receipt = await client.waitForTransactionReceipt({
                    hash,
                    onReplaced: (info) => {
                      replacement = {
                        newHash: info.transaction.hash,
                        reason: info.reason,
                      };
                    },
                    pollingInterval,
                    timeout: remaining,
                  });

                  // Only throw if there's an actual replacement (different hash)
                  if (replacement && replacement.newHash !== hash) {
                    throw new TxReplacedError({
                      message: `Transaction ${hash} was ${replacement.reason} with ${replacement.newHash}`,
                      newHash: replacement.newHash,
                      oldHash: hash,
                      reason: replacement.reason,
                    });
                  }

                  return receipt;
                },
              });
            });

            return yield* waitForReceiptAttempt.pipe(
              Effect.retry(makeReceiptRetrySchedule()),
              Effect.timeoutFail({
                duration: Duration.millis(timeout),
                onTimeout: makeReceiptTimeoutError,
              }),
              Effect.withSpan(SpanNames.TX_WAIT, {
                attributes: {
                  chainId,
                  hash,
                  timeout,
                },
              })
            );
          }
        ),
      };
    })
  );
}

export const TxManagerLive = makeTxManagerLive();
