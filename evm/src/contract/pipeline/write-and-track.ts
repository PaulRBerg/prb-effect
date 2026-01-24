import { Clock, Deferred, Effect, Fiber, Ref, Stream } from "effect";
import type { Abi, Hash, PublicClient } from "viem";
import { DEFAULT_STUCK_TX_MS } from "@/src/constants/index.js";
import type { ContractWriterShape } from "@/src/contract/index.js";
import type { PublicClientServiceShape } from "@/src/core/index.js";
import type { EventStreamShape } from "@/src/events/index.js";
import type { GasServiceShape } from "@/src/gas/index.js";
import type { NonceServiceShape } from "@/src/nonce/index.js";
import type { TxManagerShape, TxPolicy, TxReplacementShape, TxState } from "@/src/tx/index.js";
import { defaultPolicy, makeTxTracker } from "@/src/tx/index.js";
import type { ContractFunctionName } from "@/src/types/index.js";
import { applyGasLimitMultiplier, nonceToBigInt } from "./internal/helpers.js";
import { withNonceReservation } from "./internal/nonce.js";
import { deriveBaseOverrides } from "./internal/prepare.js";
import type { WriteAndTrackError, WriteAndTrackParams, WriteAndTrackResult } from "./types.js";

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

    const resultDeferred = yield* Deferred.make<WriteAndTrackResult<TAbi>, WriteAndTrackError>();

    const run = Effect.gen(function* () {
      // Step 1: Derive base overrides
      const baseOverrides = yield* deriveBaseOverrides(gasService, {
        chainId: params.chainId,
        policy,
        userOverrides: params.overrides,
      });

      // Step 2: Estimate gas first to provide a reasonable limit for simulation.
      // Some RPC nodes default to max uint64 when no gas limit is provided,
      // causing "insufficient funds" errors during the balance check.
      const estimatedGas = yield* writer.estimateGas({
        ...params,
        overrides: baseOverrides,
      });
      // Apply multiplier to add safety margin; this buffered value is used for
      // both simulation (balance check) and the final transaction.
      const derivedGas = applyGasLimitMultiplier(estimatedGas, policy.gasLimitMultiplier);

      const explicitGas = params.overrides?.gas ?? params.gas;
      const finalGas = explicitGas ?? derivedGas;

      // Step 3: Simulate with the gas limit to ensure proper balance checks
      yield* tracker.set({ status: "simulating" });
      yield* writer.simulate({ ...params, overrides: { ...baseOverrides, gas: finalGas } });
      const explicitNonce = params.overrides?.nonce;

      // Step 4: Reserve nonce
      const nonceReservation = yield* withNonceReservation(nonceService, {
        account: params.account,
        chainId: params.chainId,
        explicitNonce,
      });

      const nonce = nonceReservation.nonce;

      const overridesWithGasAndNonce = {
        ...baseOverrides,
        gas: finalGas,
        nonce,
      };

      yield* tracker.set({
        gas: finalGas,
        status: "estimated",
        tx: {
          accessList: overridesWithGasAndNonce.accessList,
          gas: finalGas,
          gasPrice: overridesWithGasAndNonce.gasPrice,
          maxFeePerGas: overridesWithGasAndNonce.maxFeePerGas,
          maxPriorityFeePerGas: overridesWithGasAndNonce.maxPriorityFeePerGas,
          nonce,
          type: overridesWithGasAndNonce.type,
        },
      });

      // Step 5: Signing
      yield* tracker.update((prev) => ({ status: "signing", tx: prev.tx }) as TxState);

      // Step 6: Write transaction
      const hash = yield* writer.write({
        ...params,
        overrides: overridesWithGasAndNonce,
      });
      yield* nonceReservation.markSubmitted;
      yield* Ref.set(currentHashRef, hash);
      yield* Ref.set(blocksElapsedRef, 0);
      yield* Ref.set(autoAttemptsRef, 0);
      yield* Ref.set(autoReplacingRef, false);
      yield* Ref.set(startedAtMsRef, yield* Clock.currentTimeMillis);
      yield* tracker.update((prev) => ({ hash, status: "submitted", tx: prev.tx }) as TxState);

      // Set up block watcher for pending state updates
      const publicClient: PublicClient = yield* publicClientService.get(params.chainId);
      const replacementStrategy =
        policy.replacement?.strategy ?? policy.replacementStrategy ?? "none";
      const stuckBlocks = policy.replacement?.stuckBlocks ?? 3;
      const stuckMs = policy.replacement?.stuckMs ?? DEFAULT_STUCK_TX_MS;
      const maxAttempts = policy.replacement?.maxAttempts ?? 1;

      const updatePendingState = (currentHash: Hash) =>
        Effect.gen(function* () {
          const blocksElapsed = yield* Ref.modify(blocksElapsedRef, (n) => [n + 1, n + 1] as const);

          yield* tracker.update((prev) => {
            if (prev.status === "mined" || prev.status === "failed") {
              return prev;
            }
            return {
              confirmations: blocksElapsed,
              hash: currentHash,
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
                  tracker.update(
                    (prev) =>
                      ({
                        newHash,
                        oldHash: currentHash,
                        reason: replacementStrategy === "cancel" ? "cancelled" : "repriced",
                        status: "replaced",
                        tx: prev.tx,
                      }) as TxState
                  ),
                  tracker.update(
                    (prev) =>
                      ({
                        hash: newHash,
                        status: "submitted",
                        tx: prev.tx,
                      }) as TxState
                  ),
                ]).pipe(Effect.asVoid);
              })
            )
          )
        );

      const autoReplaceIfStuck = (currentHash: Hash, blocksElapsed: number) => {
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
            const stuck = blocksElapsed >= stuckBlocks || elapsed >= stuckMs;
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

        const blocksElapsed = yield* updatePendingState(currentHash);
        yield* autoReplaceIfStuck(currentHash, blocksElapsed);
      });

      const pendingFiber = yield* Stream.runForEach(
        Stream.async<bigint, unknown>((emit) => {
          const unwatch = publicClient.watchBlockNumber({
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

      // Step 7: Wait for receipt (follow replacements)
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
            yield* tracker.update(
              (prev) =>
                ({
                  newHash,
                  oldHash: error.oldHash as Hash,
                  reason: error.reason,
                  status: "replaced",
                  tx: prev.tx,
                }) as TxState
            );
            yield* tracker.update(
              (prev) =>
                ({
                  hash: newHash,
                  status: "submitted",
                  tx: prev.tx,
                }) as TxState
            );

            waitHash = newHash;
            continue;
          }

          return yield* Effect.fail(error);
        }
      }).pipe(Effect.ensuring(Fiber.interrupt(pendingFiber)));

      // Step 8: Update to mined state
      yield* tracker.update(
        (prev) =>
          ({
            effectiveGasPrice: receipt.effectiveGasPrice,
            hash: receipt.transactionHash as Hash,
            receipt,
            status: "mined",
            tx: prev.tx,
          }) as TxState
      );

      if (nonceReservation.reserved) {
        yield* nonceService.confirm({
          address: params.account,
          chainId: params.chainId,
          nonce: nonceToBigInt(nonceReservation.nonce),
        });
      }

      // Step 9: Decode events
      const events = (yield* eventStream.decodeReceipt(
        receipt,
        params.abi
      )) as WriteAndTrackResult<TAbi>["events"];

      return {
        events,
        hash: receipt.transactionHash as Hash,
        receipt,
      } as WriteAndTrackResult<TAbi>;
    });

    yield* run.pipe(
      Effect.either,
      Effect.flatMap((either) =>
        either._tag === "Right"
          ? Deferred.succeed(resultDeferred, either.right)
          : Deferred.fail(resultDeferred, either.left)
      ),
      Effect.forkScoped
    );

    return {
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
            yield* tracker.update(
              (prev) =>
                ({
                  newHash,
                  oldHash: currentHash,
                  reason: "cancelled",
                  status: "replaced",
                  tx: prev.tx,
                }) as TxState
            );
            yield* tracker.update(
              (prev) =>
                ({
                  hash: newHash,
                  status: "submitted",
                  tx: prev.tx,
                }) as TxState
            );

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
            yield* tracker.update(
              (prev) =>
                ({
                  newHash,
                  oldHash: currentHash,
                  reason: "repriced",
                  status: "replaced",
                  tx: prev.tx,
                }) as TxState
            );
            yield* tracker.update(
              (prev) =>
                ({
                  hash: newHash,
                  status: "submitted",
                  tx: prev.tx,
                }) as TxState
            );

            return newHash;
          }),
      },
      result: Deferred.await(resultDeferred),
      stateRef: tracker.ref,
    };
  });
