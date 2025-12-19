import type { Scope, SubscriptionRef } from "effect";
import { Clock, Context, Effect, Layer, Stream } from "effect";
import type { Hash } from "viem";
import type { ClientNotFoundError } from "@/src/core/index.js";
import type { PersistedTx, TxStoreShape } from "@/src/platform/browser/tx-store/index.js";
import { makeTxId, TxStore } from "@/src/platform/browser/tx-store/index.js";
import type { TxRequestMeta, TxState } from "@/src/tx/index.js";
import { TxManager } from "@/src/tx/index.js";

/**
 * Optional metadata for persisting a transaction.
 */
export type TxPersistenceMeta = {
  /**
   * Human-readable description of the transaction.
   */
  readonly description?: string;

  /**
   * User-defined tags for categorization.
   */
  readonly tags?: string[];

  /**
   * Transaction request metadata (gas, nonce, etc).
   */
  readonly txRequest?: TxRequestMeta;
};

/**
 * Service shape for TxPersistence.
 * Combines TxManager tracking with TxStore persistence.
 */
export type TxPersistenceShape = {
  /**
   * Track a transaction and persist its state changes to the store.
   *
   * @param chainId - Chain ID for the transaction
   * @param hash - Transaction hash to track
   * @param meta - Optional metadata (description, tags, txRequest)
   * @returns SubscriptionRef with live transaction state updates
   */
  readonly trackAndPersist: (
    chainId: number,
    hash: Hash,
    meta?: TxPersistenceMeta
  ) => Effect.Effect<SubscriptionRef.SubscriptionRef<TxState>, ClientNotFoundError, Scope.Scope>;
};

/**
 * Context tag for TxPersistence service.
 */
export class TxPersistence extends Context.Tag("ew3/TxPersistence")<
  TxPersistence,
  TxPersistenceShape
>() {}

/**
 * Convert TxState to PersistedTx status.
 */
function mapTxStateToStatus(state: TxState): PersistedTx["status"] {
  switch (state.status) {
    case "idle":
    case "simulating":
    case "estimated":
    case "signing":
    case "submitted":
      return "submitted";
    case "pending":
      return "pending";
    case "mined":
      return "mined";
    case "failed":
      return "failed";
    case "replaced":
      // Replaced is a transition state, maintain current status
      return "submitted";
  }
}

/**
 * Convert TxRequestMeta to PersistedTxMeta (string representation).
 */
function convertTxRequestMeta(meta?: TxRequestMeta) {
  if (!meta) {
    return undefined;
  }

  return {
    gas: meta.gas?.toString(),
    gasPrice: meta.gasPrice?.toString(),
    maxFeePerGas: meta.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: meta.maxPriorityFeePerGas?.toString(),
    nonce: meta.nonce?.toString(),
    type: meta.type?.toString(),
  };
}

/**
 * Handle replacement events by updating the store with new hash and replacement history.
 */
function handleReplacement(options: {
  txId: string;
  state: Extract<TxState, { status: "replaced" }>;
  lastStatus: PersistedTx["status"];
  initialTx: PersistedTx;
  txStore: TxStoreShape;
}) {
  return Effect.gen(function* () {
    const timestamp = yield* Clock.currentTimeMillis;
    const existingTx = yield* options.txStore.get(options.txId);
    const replacements = existingTx?.replacements ?? [];

    const updatedTx: PersistedTx = {
      ...(existingTx ?? options.initialTx),
      currentHash: options.state.newHash,
      replacements: [
        ...replacements,
        {
          at: timestamp,
          newHash: options.state.newHash,
          oldHash: options.state.oldHash,
          reason: options.state.reason,
        },
      ],
      status: options.lastStatus,
      updatedAt: timestamp,
    };

    yield* options.txStore.upsert(updatedTx).pipe(Effect.catchAll(() => Effect.void));

    return options.state.newHash;
  });
}

/**
 * Handle status changes by updating the store.
 */
function handleStatusChange(options: {
  txId: string;
  newStatus: PersistedTx["status"];
  currentHash: Hash;
  initialTx: PersistedTx;
  txStore: TxStoreShape;
}) {
  return Effect.gen(function* () {
    const timestamp = yield* Clock.currentTimeMillis;
    const existingTx = yield* options.txStore.get(options.txId);

    const updatedTx: PersistedTx = {
      ...(existingTx ?? options.initialTx),
      currentHash: options.currentHash,
      status: options.newStatus,
      updatedAt: timestamp,
    };

    yield* options.txStore.upsert(updatedTx).pipe(Effect.catchAll(() => Effect.void));

    // Return true if terminal state reached
    return options.newStatus === "mined" || options.newStatus === "failed";
  });
}

/**
 * Live implementation of TxPersistence service.
 */
export const TxPersistenceLive = Layer.effect(
  TxPersistence,
  Effect.gen(function* () {
    const txManager = yield* TxManager;
    const txStore = yield* TxStore;

    return TxPersistence.of({
      trackAndPersist: (chainId: number, hash: Hash, meta?: TxPersistenceMeta) =>
        Effect.scoped(
          Effect.gen(function* () {
            const createdAt = yield* Clock.currentTimeMillis;
            const txId = makeTxId(chainId, hash);

            // Create initial persisted entry
            const initialTx: PersistedTx = {
              chainId,
              createdAt,
              currentHash: hash,
              description: meta?.description,
              id: txId,
              replacements: [],
              rootHash: hash,
              status: "submitted",
              tags: meta?.tags,
              txMeta: convertTxRequestMeta(meta?.txRequest),
              updatedAt: createdAt,
            };

            // Persist initial state (ignore errors)
            yield* txStore.upsert(initialTx).pipe(Effect.catchAll(() => Effect.void));

            // Track the transaction
            const stateRef = yield* txManager.track(chainId, hash);

            // Fork a fiber to listen to state changes and update the store
            yield* Effect.forkScoped(
              Effect.gen(function* () {
                let lastStatus: PersistedTx["status"] = "submitted";
                let currentHash = hash;

                yield* Stream.runForEach(stateRef.changes, (state) =>
                  Effect.gen(function* () {
                    const newStatus = mapTxStateToStatus(state);

                    // Handle replacement events
                    if (state.status === "replaced") {
                      currentHash = yield* handleReplacement({
                        initialTx,
                        lastStatus,
                        state,
                        txId,
                        txStore,
                      });
                      return;
                    }

                    // Only update on status change
                    if (newStatus !== lastStatus) {
                      lastStatus = newStatus;
                      const isTerminal = yield* handleStatusChange({
                        currentHash,
                        initialTx,
                        newStatus,
                        txId,
                        txStore,
                      });

                      if (isTerminal) {
                        yield* Effect.interrupt;
                      }
                    }
                  })
                );
              })
            );

            return stateRef;
          })
        ),
    });
  })
);

/**
 * Rehydrate all in-flight transactions from the store.
 * Creates tracking fibers for each transaction.
 */
const rehydrateAll = Effect.gen(function* () {
  const txStore = yield* TxStore;
  const txManager = yield* TxManager;

  const inFlightTxs = yield* txStore.getInFlight().pipe(Effect.catchAll(() => Effect.succeed([])));

  yield* Effect.all(
    inFlightTxs.map(
      (tx: PersistedTx) =>
        Effect.gen(function* () {
          // Track the current hash
          const stateRef = yield* txManager.track(tx.chainId, tx.currentHash);

          // Fork persistence fiber
          yield* Effect.forkScoped(
            Effect.gen(function* () {
              let lastStatus = tx.status;
              let currentHash = tx.currentHash;

              yield* Stream.runForEach(stateRef.changes, (state) =>
                Effect.gen(function* () {
                  const newStatus = mapTxStateToStatus(state);

                  // Handle replacement events
                  if (state.status === "replaced") {
                    currentHash = yield* handleReplacement({
                      initialTx: tx,
                      lastStatus,
                      state,
                      txId: tx.id,
                      txStore,
                    });
                    return;
                  }

                  // Only update on status change
                  if (newStatus !== lastStatus) {
                    lastStatus = newStatus;
                    const isTerminal = yield* handleStatusChange({
                      currentHash,
                      initialTx: tx,
                      newStatus,
                      txId: tx.id,
                      txStore,
                    });

                    if (isTerminal) {
                      yield* Effect.interrupt;
                    }
                  }
                })
              );
            })
          );
        }).pipe(Effect.catchAll(() => Effect.void)) // Ignore errors for individual txs
    ),
    { concurrency: "unbounded" }
  );
});

/**
 * Live implementation with auto-rehydration.
 * On initialization, loads all in-flight transactions and starts tracking them.
 */
export const TxPersistenceWithRehydrationLive = Layer.scopedDiscard(
  Effect.forkScoped(rehydrateAll)
).pipe(Layer.provideMerge(TxPersistenceLive));
