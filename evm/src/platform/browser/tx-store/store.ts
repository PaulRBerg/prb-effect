import { Context, Effect, Layer, Option, Ref, Stream, SubscriptionRef } from "effect";
import type { TxStoreError } from "./errors.js";
import type { PersistedTx, TxStoreChange } from "./types.js";
import { isInFlightPersistedTx } from "./types.js";

/**
 * Service interface for transaction store operations.
 * Provides CRUD operations for persisted transaction records.
 */
export type TxStoreShape = {
  /**
   * Stream of transaction changes emitted on each upsert/delete.
   */
  readonly changes: Stream.Stream<TxStoreChange>;

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
   * Retrieve all in-flight transactions (submitted, pending, or queued status).
   */
  readonly getInFlight: () => Effect.Effect<PersistedTx[], TxStoreError>;

  /**
   * Stream of in-flight transactions. Emits whenever store contents change.
   */
  readonly watchInFlight: () => Stream.Stream<PersistedTx[]>;
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
    const inFlightRef = yield* SubscriptionRef.make<PersistedTx[]>([]);
    const changesRef = yield* SubscriptionRef.make<Option.Option<TxStoreChange>>(Option.none());

    const toInFlight = (map: Map<string, PersistedTx>) =>
      Array.from(map.values()).filter(isInFlightPersistedTx);

    return TxStore.of({
      changes: Stream.filterMap(changesRef.changes, (change) => change),

      delete: (id: string) =>
        Effect.gen(function* () {
          const [previous, nextMap] = yield* Ref.modify(store, (map) => {
            const newMap = new Map(map);
            const existing = newMap.get(id) ?? null;
            newMap.delete(id);
            return [[existing, newMap] as const, newMap] as const;
          });

          yield* SubscriptionRef.set(inFlightRef, toInFlight(nextMap));
          yield* SubscriptionRef.set(
            changesRef,
            Option.some({
              _tag: "delete",
              at: Date.now(),
              id,
              previous,
            } satisfies TxStoreChange)
          );
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
          return toInFlight(map);
        }),

      upsert: (tx: PersistedTx) =>
        Effect.gen(function* () {
          const [previous, nextMap] = yield* Ref.modify(store, (map) => {
            const newMap = new Map(map);
            const existing = newMap.get(tx.id) ?? null;
            newMap.set(tx.id, tx);
            return [[existing, newMap] as const, newMap] as const;
          });

          yield* SubscriptionRef.set(inFlightRef, toInFlight(nextMap));
          yield* SubscriptionRef.set(
            changesRef,
            Option.some({
              _tag: "upsert",
              at: Date.now(),
              next: tx,
              previous,
            } satisfies TxStoreChange)
          );
        }),

      watchInFlight: () => inFlightRef.changes,
    });
  })
);
