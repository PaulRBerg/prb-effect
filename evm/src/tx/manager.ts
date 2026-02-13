import type { Scope, SubscriptionRef } from "effect";
import { Clock, Context, Duration, Effect, Fiber, Layer, Ref, Stream } from "effect";
import type { Hash, TransactionReceipt } from "viem";
import { WaitForTransactionReceiptTimeoutError } from "viem";
import { DEFAULT_RECEIPT_TIMEOUT, DEFAULT_STUCK_TX_MS } from "#src/constants/index.js";
import type { ClientNotFoundError, TxReplacementReason } from "#src/core/index.js";
import {
  PublicClientService,
  ReceiptTimeoutError,
  TransportError,
  TxFailedError,
  TxReplacedError,
} from "#src/core/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import { makeReceiptRetrySchedule } from "./internal/receipt-retry.js";
import type { TxPolicy } from "./policy.js";
import { defaultPolicy } from "./policy.js";
import type { TxReplacementShape } from "./replacement.js";
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

type TxTracker = {
  readonly set: (state: TxState) => Effect.Effect<void>;
};

type ReplacementInfo = {
  readonly oldHash: Hash;
  readonly newHash: Hash;
  readonly reason: TxReplacementReason;
};

type ReplacementRefs = {
  readonly currentHashRef: Ref.Ref<Hash>;
  readonly confirmationsRef: Ref.Ref<number>;
  readonly startedAtMsRef: Ref.Ref<number>;
  readonly autoAttemptsRef: Ref.Ref<number>;
  readonly autoReplacingRef: Ref.Ref<boolean>;
};

type BlockWatcherClient = {
  readonly watchBlockNumber: (params: {
    readonly onBlockNumber: (blockNumber: bigint) => void;
    readonly onError: (error: unknown) => void;
    readonly pollingInterval?: number | undefined;
  }) => () => void;
};

type ReceiptWaiterClient = {
  readonly waitForTransactionReceipt: (params: {
    readonly hash: Hash;
    readonly onReplaced?: (info: {
      readonly transaction: { readonly hash: Hash };
      readonly replacedTransaction: { readonly hash: Hash };
      readonly reason: TxReplacementReason;
    }) => void;
    readonly pollingInterval?: number | undefined;
    readonly timeout?: number | undefined;
  }) => Promise<TransactionReceipt>;
};

type ReceiptOutcome =
  | { readonly _tag: "Left"; readonly cause: unknown }
  | {
      readonly _tag: "Right";
      readonly receipt: TransactionReceipt;
      readonly replacement: ReplacementInfo | undefined;
    };

function performAutoReplacement(params: {
  readonly chainId: number;
  readonly currentHash: Hash;
  readonly now: number;
  readonly policy: TxPolicy;
  readonly replacementStrategy: "speedup" | "cancel";
  readonly txReplacement: TxReplacementShape;
  readonly refs: ReplacementRefs;
  readonly tracker: TxTracker;
}): Effect.Effect<void> {
  const { chainId, currentHash, now, policy, replacementStrategy, refs, tracker, txReplacement } =
    params;

  return Ref.set(refs.autoReplacingRef, true).pipe(
    Effect.zipRight(
      (replacementStrategy === "cancel"
        ? txReplacement.cancel(chainId, currentHash, policy)
        : txReplacement.speedup(chainId, currentHash, policy)
      ).pipe(
        Effect.either,
        Effect.ensuring(Ref.set(refs.autoReplacingRef, false)),
        Effect.flatMap((replaced) => {
          if (replaced._tag === "Left") {
            return Effect.void;
          }

          const newHash = replaced.right;
          return Effect.all([
            Ref.set(refs.currentHashRef, newHash),
            Ref.set(refs.confirmationsRef, 0),
            Ref.set(refs.startedAtMsRef, now),
            Ref.update(refs.autoAttemptsRef, (n) => n + 1),
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
}

function handleReceiptFailure(params: {
  readonly cause: unknown;
  readonly hash: Hash;
  readonly policy: TxPolicy;
  readonly tracker: TxTracker;
}): Effect.Effect<void> {
  const { cause, hash, policy, tracker } = params;
  const timeout = policy.receiptTimeout ?? DEFAULT_RECEIPT_TIMEOUT;

  const failure =
    cause instanceof WaitForTransactionReceiptTimeoutError
      ? new ReceiptTimeoutError({
          hash,
          message: cause.message,
          timeout,
        })
      : cause;

  return tracker.set({
    error: new TxFailedError({
      cause: failure,
      hash,
      message: failure instanceof Error ? failure.message : String(failure),
    }),
    phase: "receipt",
    status: "failed",
  });
}

function applyReplacement(params: {
  readonly replacement: ReplacementInfo | undefined;
  readonly currentHashRef: Ref.Ref<Hash>;
  readonly tracker: TxTracker;
}): Effect.Effect<void> {
  const { replacement, currentHashRef, tracker } = params;

  if (!replacement) {
    return Effect.void;
  }

  return Effect.gen(function* () {
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
  });
}

function updatePendingState(params: {
  readonly currentHash: Hash;
  readonly confirmationsRef: Ref.Ref<number>;
  readonly tracker: TxTracker;
}): Effect.Effect<number> {
  const { currentHash, confirmationsRef, tracker } = params;

  return Effect.gen(function* () {
    const confirmations = yield* Ref.modify(confirmationsRef, (n) => [n + 1, n + 1] as const);
    yield* tracker.set({
      confirmations,
      hash: currentHash,
      status: "pending",
    });
    return confirmations;
  });
}

function autoReplaceIfStuck(params: {
  readonly chainId: number;
  readonly currentHash: Hash;
  readonly replacementStrategy: "speedup" | "cancel" | "none";
  readonly stuckMs: number;
  readonly maxAttempts: number;
  readonly policy: TxPolicy;
  readonly refs: ReplacementRefs;
  readonly tracker: TxTracker;
  readonly txReplacement: TxReplacementShape;
}): Effect.Effect<void> {
  const {
    chainId,
    currentHash,
    replacementStrategy,
    stuckMs,
    maxAttempts,
    policy,
    refs,
    tracker,
    txReplacement,
  } = params;

  if (replacementStrategy === "none") {
    return Effect.void;
  }

  return Effect.all({
    alreadyReplacing: Ref.get(refs.autoReplacingRef),
    attempts: Ref.get(refs.autoAttemptsRef),
    now: Clock.currentTimeMillis,
    startedAt: Ref.get(refs.startedAtMsRef),
  }).pipe(
    Effect.flatMap(({ alreadyReplacing, attempts, now, startedAt }) => {
      const elapsed = startedAt > 0 ? now - startedAt : 0;
      const stuck = elapsed >= stuckMs;
      const allowed = attempts < maxAttempts && !alreadyReplacing;
      return stuck && allowed
        ? performAutoReplacement({
            chainId,
            currentHash,
            now,
            policy,
            refs,
            replacementStrategy,
            tracker,
            txReplacement,
          })
        : Effect.void;
    })
  );
}

function startPendingBlockTracking(params: {
  readonly client: BlockWatcherClient;
  readonly pollingInterval: number | undefined;
  readonly onPendingBlock: Effect.Effect<void>;
}) {
  const { client, pollingInterval, onPendingBlock } = params;

  return Stream.runForEach(
    Stream.async<bigint, unknown>((emit) => {
      const unwatch = client.watchBlockNumber({
        onBlockNumber: (blockNumber: bigint) => emit.single(blockNumber),
        onError: (error) => emit.fail(error as unknown),
        pollingInterval,
      });

      return Effect.sync(() => {
        unwatch();
      });
    }),
    () => onPendingBlock
  ).pipe(Effect.forkScoped);
}

function waitForReceiptWithReplacement(params: {
  readonly client: ReceiptWaiterClient;
  readonly hash: Hash;
  readonly policy: TxPolicy;
  readonly pendingFiber: Fiber.Fiber<unknown, unknown>;
}): Effect.Effect<ReceiptOutcome> {
  const { client, hash, pendingFiber, policy } = params;
  let replacement: ReplacementInfo | undefined;

  return Effect.either(
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
  ).pipe(
    Effect.ensuring(Fiber.interrupt(pendingFiber)),
    Effect.map((result) =>
      result._tag === "Left"
        ? { _tag: "Left", cause: result.left }
        : { _tag: "Right", receipt: result.right, replacement }
    )
  );
}

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
            Effect.gen(function* () {
              const currentHashRef = yield* Ref.make<Hash>(hash);
              const confirmationsRef = yield* Ref.make(0);
              const startedAtMsRef = yield* Ref.make(yield* Clock.currentTimeMillis);
              const autoAttemptsRef = yield* Ref.make(0);
              const autoReplacingRef = yield* Ref.make(false);
              const refs: ReplacementRefs = {
                autoAttemptsRef,
                autoReplacingRef,
                confirmationsRef,
                currentHashRef,
                startedAtMsRef,
              };

              const replacementStrategy =
                policy.replacement?.strategy ?? policy.replacementStrategy ?? "none";
              const stuckMs = policy.replacement?.stuckMs ?? DEFAULT_STUCK_TX_MS;
              const maxAttempts = policy.replacement?.maxAttempts ?? 1;

              const onPendingBlock = Effect.gen(function* () {
                const currentHash = yield* Ref.get(currentHashRef);
                yield* updatePendingState({ confirmationsRef, currentHash, tracker });
                yield* autoReplaceIfStuck({
                  chainId,
                  currentHash,
                  maxAttempts,
                  policy,
                  refs,
                  replacementStrategy,
                  stuckMs,
                  tracker,
                  txReplacement,
                });
              });

              const pendingFiber = yield* startPendingBlockTracking({
                client,
                onPendingBlock,
                pollingInterval: policy.pollingInterval,
              });

              const receiptOutcome = yield* waitForReceiptWithReplacement({
                client,
                hash,
                pendingFiber,
                policy,
              });

              if (receiptOutcome._tag === "Left") {
                yield* handleReceiptFailure({
                  cause: receiptOutcome.cause,
                  hash,
                  policy,
                  tracker,
                });
                return;
              }

              const receipt = receiptOutcome.receipt;

              yield* applyReplacement({
                currentHashRef,
                replacement: receiptOutcome.replacement,
                tracker,
              });

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
