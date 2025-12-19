import { Context, Effect, Layer, Ref } from "effect";
import type { TxStoreError } from "./errors.js";
import type { PersistedTx } from "./types.js";

/**
 * Service interface for transaction store operations.
 * Provides CRUD operations for persisted transaction records.
 */
export type TxStoreShape = {
  /**
   * Retrieve all transactions from the store.
   */
  readonly getAll: () => Effect.Effect<PersistedTx[], TxStoreError>;

  /**
   * Retrieve a single transaction by ID.
   * Returns null if the transaction does not exist.
   */
  readonly get: (id: string) => Effect.Effect<PersistedTx | null, TxStoreError>;

  /**
   * Insert or update a transaction in the store.
   */
  readonly upsert: (tx: PersistedTx) => Effect.Effect<void, TxStoreError>;

  /**
   * Delete a transaction from the store by ID.
   */
  readonly delete: (id: string) => Effect.Effect<void, TxStoreError>;

  /**
   * Retrieve all in-flight transactions (submitted or pending status).
   */
  readonly getInFlight: () => Effect.Effect<PersistedTx[], TxStoreError>;
};

/**
 * Context tag for the TxStore service.
 */
export class TxStore extends Context.Tag("ew3/TxStore")<TxStore, TxStoreShape>() {}

/**
 * In-memory implementation of TxStore using a Ref-based Map.
 * Useful for testing or when persistence is not required.
 */
export const InMemoryTxStoreLive = Layer.effect(
  TxStore,
  Effect.gen(function* () {
    const store = yield* Ref.make(new Map<string, PersistedTx>());

    return TxStore.of({
      delete: (id: string) =>
        Effect.gen(function* () {
          yield* Ref.update(store, (map) => {
            const newMap = new Map(map);
            newMap.delete(id);
            return newMap;
          });
        }),

      get: (id: string) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(store);
          return map.get(id) ?? null;
        }),
      getAll: () =>
        Effect.gen(function* () {
          const map = yield* Ref.get(store);
          return Array.from(map.values());
        }),

      getInFlight: () =>
        Effect.gen(function* () {
          const map = yield* Ref.get(store);
          return Array.from(map.values()).filter(
            (tx) => tx.status === "submitted" || tx.status === "pending"
          );
        }),

      upsert: (tx: PersistedTx) =>
        Effect.gen(function* () {
          yield* Ref.update(store, (map) => {
            const newMap = new Map(map);
            newMap.set(tx.id, tx);
            return newMap;
          });
        }),
    });
  })
);
