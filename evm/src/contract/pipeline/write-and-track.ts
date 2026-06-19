import type { Scope } from "effect";
import { Clock, Deferred, Effect, Fiber, Ref, Stream } from "effect";
import type { Abi, Hash, PublicClient } from "viem";
import { DEFAULT_STUCK_TX_MS } from "#src/constants/index.js";
import type { ContractWriterShape } from "#src/contract/index.js";
import type { PublicClientServiceShape } from "#src/core/index.js";
import { isNonceTooLowError, TxFailedError } from "#src/core/index.js";
import type { EventStreamShape } from "#src/events/index.js";
import type { GasServiceShape } from "#src/gas/index.js";
import type { NonceServiceShape } from "#src/nonce/index.js";
import type {
  TxFailedPhase,
  TxManagerShape,
  TxPolicy,
  TxPreflightWarning,
  TxReplacementShape,
  TxState,
} from "#src/tx/index.js";
import { defaultPolicy, makeTxTracker } from "#src/tx/index.js";
import type { ContractFunctionName } from "#src/types/index.js";
import type { NonceReservationResult } from "./internal/nonce.js";
import {
  advanceNonceAfterNonceTooLow,
  confirmNonce,
  withNonceReservation,
} from "./internal/nonce.js";
import { deriveBaseOverrides, runPreflight } from "./internal/prepare.js";
import type {
  WriteAndTrackError,
  WriteAndTrackParams,
  WriteAndTrackResult,
  WriteAndTrackTerminal,
} from "./types.js";

/**
 * Dependencies required by writeAndTrack
 */
export type WriteAndTrackDeps = {
  readonly writer: ContractWriterShape;
  readonly txManager: TxManagerShape;
  readonly eventStream: EventStreamShape;
  readonly nonceService: NonceServiceShape;
  readonly txReplacement: TxReplacementShape;
  readonly publicClientService: PublicClientServiceShape;
  readonly gasService: GasServiceShape;
};

const MAX_NONCE_TOO_LOW_RETRIES = 2;

function toTxFailedError(error: WriteAndTrackError, hash: Hash | null): TxFailedError {
  if (error._tag === "TxFailedError") {
    return error;
  }

  return new TxFailedError({
    cause: error,
    hash: hash ?? "unknown",
    message: error.message,
  });
}

/**
 * Create the writeAndTrack implementation with full tracking orchestration
 */
export const makeWriteAndTrack = (deps: WriteAndTrackDeps) =>
  Effect.fn("ContractPipeline.writeAndTrack")(function* <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(params: WriteAndTrackParams<TAbi, TFunctionName>) {
    const {
      writer,
      txManager,
      eventStream,
      nonceService,
      txReplacement,
      publicClientService,
      gasService,
    } = deps;

    const tracker = yield* makeTxTracker;
    const policy = params.policy ?? defaultPolicy;
    const currentHashRef = yield* Ref.make<Hash | null>(null);
    const blocksElapsedRef = yield* Ref.make(0);
    const startedAtMsRef = yield* Ref.make(0);
    const autoAttemptsRef = yield* Ref.make(0);
    const autoReplacingRef = yield* Ref.make(false);

    const terminalDeferred = yield* Deferred.make<
      WriteAndTrackTerminal<TAbi>,
      WriteAndTrackError
    >();
    const preflightMode = params.preflight?.mode ?? "strict";
    let failurePhase: TxFailedPhase = "preflight";
    let preflightWarning: TxPreflightWarning | undefined;

    const setSubmittedState = (hash: Hash) =>
      tracker.update(
        (prev) =>
          ({
            hash,
            preflightWarning: prev.preflightWarning,
            status: "submitted",
            tx: prev.tx,
          }) as TxState
      );

    const setReplacedState = (
      oldHash: Hash,
      newHash: Hash,
      reason: "cancelled" | "replaced" | "repriced"
    ) =>
      tracker.update(
        (prev) =>
          ({
            newHash,
            oldHash,
            preflightWarning: prev.preflightWarning,
            reason,
            status: "replaced",
            tx: prev.tx,
          }) as TxState
      );

    const run = Effect.gen(function* () {
      const baseOverrides = yield* deriveBaseOverrides(gasService, {
        chainId: params.chainId,
        policy,
        userOverrides: params.overrides,
      });

      const preflight = yield* runPreflight(writer, params, baseOverrides, policy, {
        mode: preflightMode,
        onSimulating: () => tracker.set({ status: "simulating" }),
      });
      preflightWarning = preflight.preflightWarning;

      const explicitNonce = params.overrides?.nonce;

      type SubmissionAttemptResult =
        | { readonly _tag: "retryNonceTooLow" }
        | {
            readonly _tag: "terminal";
            readonly terminal: WriteAndTrackTerminal<TAbi>;
          };

      const trackSubmittedTransaction = (
        hash: Hash,
        nonceReservation: NonceReservationResult
      ): Effect.Effect<WriteAndTrackTerminal<TAbi>, WriteAndTrackError, Scope.Scope> =>
        Effect.gen(function* () {
          yield* Ref.set(currentHashRef, hash);
          yield* Ref.set(blocksElapsedRef, 0);
          yield* Ref.set(autoAttemptsRef, 0);
          yield* Ref.set(autoReplacingRef, false);
          yield* Ref.set(startedAtMsRef, yield* Clock.currentTimeMillis);
          yield* setSubmittedState(hash);

          const publicClient: PublicClient = yield* publicClientService.get(params.chainId);
          const replacementStrategy =
            policy.replacement?.strategy ?? policy.replacementStrategy ?? "none";
          const stuckMs = policy.replacement?.stuckMs ?? DEFAULT_STUCK_TX_MS;
          const maxAttempts = policy.replacement?.maxAttempts ?? 1;

          const updatePendingState = (currentHash: Hash) =>
            Effect.gen(function* () {
              const blocksElapsed = yield* Ref.modify(
                blocksElapsedRef,
                (n) => [n + 1, n + 1] as const
              );

              yield* tracker.update((prev) => {
                if (prev.status === "mined" || prev.status === "failed") {
                  return prev;
                }

                return {
                  // An unmined tx has zero confirmations; blocksElapsed is only for stuck-tx detection.
                  confirmations: 0,
                  hash: currentHash,
                  preflightWarning: prev.preflightWarning,
                  status: "pending",
                  tx: prev.tx,
                } as TxState;
              });

              return blocksElapsed;
            });

          const performAutoReplacement = (currentHash: Hash, now: number) =>
            Ref.set(autoReplacingRef, true).pipe(
              Effect.zipRight(
                (replacementStrategy === "cancel"
                  ? txReplacement.cancel(params.chainId, currentHash, policy)
                  : txReplacement.speedup(params.chainId, currentHash, policy)
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
                      Ref.set(blocksElapsedRef, 0),
                      Ref.set(startedAtMsRef, now),
                      Ref.update(autoAttemptsRef, (n) => n + 1),
                      setReplacedState(
                        currentHash,
                        newHash,
                        replacementStrategy === "cancel" ? "cancelled" : "repriced"
                      ),
                      setSubmittedState(newHash),
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
                return stuck && allowed ? performAutoReplacement(currentHash, now) : Effect.void;
              })
            );
          };

          const onPendingBlock = Effect.gen(function* () {
            const currentHash = yield* Ref.get(currentHashRef);
            if (!currentHash) {
              return;
            }

            yield* updatePendingState(currentHash);
            yield* autoReplaceIfStuck(currentHash);
          });

          const pendingFiber = yield* Stream.runForEach(
            Stream.async<bigint, unknown>((emit) => {
              const unwatch = publicClient.watchBlockNumber({
                pollingInterval: policy.pollingInterval,
                onBlockNumber: (blockNumber: bigint) => emit.single(blockNumber),
                onError: (error) => emit.fail(error as unknown),
              });

              return Effect.sync(() => {
                unwatch();
              });
            }),
            () => onPendingBlock
          ).pipe(Effect.forkScoped);

          failurePhase = "receipt";
          const receipt = yield* Effect.gen(function* () {
            let waitHash = hash;

            while (true) {
              const exit = yield* txManager
                .waitForReceipt(params.chainId, waitHash, policy)
                .pipe(Effect.either);

              if (exit._tag === "Right") {
                return exit.right;
              }

              const error = exit.left;
              if (error._tag === "TxReplacedError") {
                const newHash = error.newHash as Hash;
                const now = yield* Clock.currentTimeMillis;

                yield* Ref.set(currentHashRef, newHash);
                yield* Ref.set(blocksElapsedRef, 0);
                yield* Ref.set(startedAtMsRef, now);
                yield* setReplacedState(error.oldHash as Hash, newHash, error.reason);
                yield* setSubmittedState(newHash);

                waitHash = newHash;
                continue;
              }

              return yield* Effect.fail(error);
            }
          }).pipe(Effect.ensuring(Fiber.interrupt(pendingFiber)));

          // Confirm the nonce as soon as the tx is mined - a reverted tx still
          // consumes its nonce on-chain, so confirming only on success would leak
          // it in the manager's pending set forever. This runs before the revert
          // check below.
          yield* confirmNonce(nonceService, {
            account: params.account,
            chainId: params.chainId,
            nonce: nonceReservation.nonce,
            reserved: nonceReservation.reserved,
          });

          // Fail if the transaction was mined but reverted
          if (receipt.status === "reverted") {
            return yield* Effect.fail(
              new TxFailedError({
                hash: receipt.transactionHash as Hash,
                message: `Transaction ${receipt.transactionHash} reverted onchain`,
              })
            );
          }

          yield* tracker.update(
            (prev) =>
              ({
                effectiveGasPrice: receipt.effectiveGasPrice,
                hash: receipt.transactionHash as Hash,
                preflightWarning: prev.preflightWarning,
                receipt,
                status: "mined",
                tx: prev.tx,
              }) as TxState
          );

          failurePhase = "event-decode";
          const events = (yield* eventStream.decodeReceipt(
            receipt,
            params.abi
          )) as WriteAndTrackResult<TAbi>["events"];

          return {
            _tag: "success",
            events,
            hash: receipt.transactionHash as Hash,
            receipt,
          } as WriteAndTrackTerminal<TAbi>;
        });

      const submitOnce = (
        attempt: number
      ): Effect.Effect<SubmissionAttemptResult, WriteAndTrackError> =>
        // The nonce reservation's release finalizer must fire as soon as this
        // attempt completes or fails, not when the caller's long-lived tracking
        // scope closes. On nonce-low retry, `confirm` + `markSubmitted` advance
        // the local floor and prevent a late release of the consumed nonce.
        Effect.scoped(
          Effect.gen(function* () {
            const nonceReservation = yield* withNonceReservation(nonceService, {
              account: params.account,
              chainId: params.chainId,
              explicitNonce,
            });

            const overridesWithGasAndNonce = {
              ...preflight.overridesWithGas,
              nonce: nonceReservation.nonce,
            };

            const txPreview = {
              accessList: overridesWithGasAndNonce.accessList,
              gas: overridesWithGasAndNonce.gas,
              gasPrice: overridesWithGasAndNonce.gasPrice,
              maxFeePerGas: overridesWithGasAndNonce.maxFeePerGas,
              maxPriorityFeePerGas: overridesWithGasAndNonce.maxPriorityFeePerGas,
              nonce: nonceReservation.nonce,
              type: overridesWithGasAndNonce.type,
            } as const;

            if (preflight.finalGas != null) {
              yield* tracker.set({
                gas: preflight.finalGas,
                preflightWarning,
                status: "estimated",
                tx: txPreview,
              });
            }

            yield* tracker.set({
              preflightWarning,
              status: "signing",
              tx: txPreview,
            });

            failurePhase = "submission";
            const writeResult = yield* writer
              .write({
                ...params,
                overrides: overridesWithGasAndNonce,
              })
              .pipe(Effect.either);

            if (writeResult._tag === "Left") {
              const error = writeResult.left;
              const currentHash = yield* Ref.get(currentHashRef);
              const shouldRetryNonceTooLow =
                explicitNonce === undefined &&
                nonceReservation.reserved &&
                attempt < MAX_NONCE_TOO_LOW_RETRIES &&
                currentHash === null &&
                isNonceTooLowError(error);

              if (!shouldRetryNonceTooLow) {
                return yield* Effect.fail(error);
              }

              yield* advanceNonceAfterNonceTooLow(nonceService, {
                account: params.account,
                chainId: params.chainId,
                nonce: nonceReservation.nonce,
                reserved: nonceReservation.reserved,
              });
              yield* nonceReservation.markSubmitted;

              return { _tag: "retryNonceTooLow" } as const;
            }

            const hash = writeResult.right;

            yield* nonceReservation.markSubmitted;
            const terminal = yield* trackSubmittedTransaction(hash, nonceReservation);

            return {
              _tag: "terminal",
              terminal,
            } as const;
          })
        );

      const submitWithNonceRecovery = (
        attempt: number
      ): Effect.Effect<WriteAndTrackTerminal<TAbi>, WriteAndTrackError> =>
        Effect.gen(function* () {
          const result = yield* submitOnce(attempt);
          if (result._tag === "retryNonceTooLow") {
            return yield* submitWithNonceRecovery(attempt + 1);
          }

          return result.terminal;
        });

      return yield* submitWithNonceRecovery(0);
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const currentHash = yield* Ref.get(currentHashRef);
          const failedError = toTxFailedError(error, currentHash);

          yield* tracker.update(
            (prev) =>
              ({
                error: failedError,
                phase: failurePhase,
                preflightWarning: prev.preflightWarning ?? preflightWarning,
                status: "failed",
                tx: prev.tx,
              }) as TxState
          );

          return yield* Effect.fail(error);
        })
      )
    );

    yield* run.pipe(
      Effect.either,
      Effect.flatMap((either) =>
        either._tag === "Right"
          ? Deferred.succeed(terminalDeferred, either.right)
          : Deferred.fail(terminalDeferred, either.left)
      ),
      // If the tracking scope closes mid-flight this fiber is interrupted before the
      // Deferred resolves; interrupt the Deferred so an out-of-scope `terminal`
      // awaiter fails with interruption instead of hanging forever. No-op once the
      // Deferred is already completed above.
      Effect.ensuring(Deferred.interrupt(terminalDeferred)),
      Effect.forkScoped
    );

    return {
      stateRef: tracker.ref,
      terminal: Deferred.await(terminalDeferred),
      actions: {
        cancel: (overridePolicy?: TxPolicy) =>
          Effect.gen(function* () {
            const currentHash = yield* Ref.get(currentHashRef);
            if (!currentHash) {
              return yield* Effect.fail(new Error("Transaction not yet submitted"));
            }

            const nextPolicy = overridePolicy ?? policy;
            const newHash = yield* txReplacement.cancel(params.chainId, currentHash, nextPolicy);
            const now = yield* Clock.currentTimeMillis;

            yield* Ref.set(currentHashRef, newHash);
            yield* Ref.set(blocksElapsedRef, 0);
            yield* Ref.set(startedAtMsRef, now);
            yield* setReplacedState(currentHash, newHash, "cancelled");
            yield* setSubmittedState(newHash);

            return newHash;
          }),

        speedup: (overridePolicy?: TxPolicy) =>
          Effect.gen(function* () {
            const currentHash = yield* Ref.get(currentHashRef);
            if (!currentHash) {
              return yield* Effect.fail(new Error("Transaction not yet submitted"));
            }

            const nextPolicy = overridePolicy ?? policy;
            const newHash = yield* txReplacement.speedup(params.chainId, currentHash, nextPolicy);
            const now = yield* Clock.currentTimeMillis;

            yield* Ref.set(currentHashRef, newHash);
            yield* Ref.set(blocksElapsedRef, 0);
            yield* Ref.set(startedAtMsRef, now);
            yield* setReplacedState(currentHash, newHash, "repriced");
            yield* setSubmittedState(newHash);

            return newHash;
          }),
      },
    };
  });
