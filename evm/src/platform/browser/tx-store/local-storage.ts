import { Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect";
import { BrowserStorage } from "../storage/index.js";
import type { TxStoreError } from "./errors.js";
import { TxStore } from "./store.js";
import type { PersistedTx, TxStoreChange } from "./types.js";
import { isInFlightPersistedTx } from "./types.js";

/**
 * Configuration for LocalStorageTxStore.
 */
export type LocalStorageTxStoreConfig = {
  /**
   * Maximum number of transactions to retain in storage.
   * When exceeded, oldest terminal (mined/failed) transactions are pruned.
   * @default 200
   */
  maxTxs?: number;
};

/**
 * Default configuration for LocalStorageTxStore.
 */
const DEFAULT_CONFIG: Required<LocalStorageTxStoreConfig> = {
  maxTxs: 200,
};

/**
 * Key prefix for transaction storage.
 */
const TX_KEY_PREFIX = "ew3:v1:tx:";

/**
 * Key for the transaction index (stores array of tx IDs).
 */
const INDEX_KEY = "ew3:v1:tx:index";

/**
 * Key prefix for quarantined corrupt transactions.
 */
const CORRUPT_KEY_PREFIX = "ew3:v1:tx:corrupt:";

const HashSchema = Schema.TemplateLiteral(["0x", Schema.String]);
const isPersistedTx = Schema.is(
  Schema.Struct({
    chainId: Schema.Int,
    createdAt: Schema.Finite,
    currentHash: HashSchema,
    data: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    from: Schema.optional(Schema.String),
    id: Schema.String,
    replacements: Schema.mutable(
      Schema.Array(
        Schema.Struct({
          at: Schema.Finite,
          newHash: HashSchema,
          oldHash: HashSchema,
          reason: Schema.Literals(["cancelled", "replaced", "repriced"]),
        })
      )
    ),
    rootHash: HashSchema,
    status: Schema.Literals(["submitted", "pending", "queued", "mined", "failed", "cancelled"]),
    tags: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    to: Schema.optional(Schema.String),
    txMeta: Schema.optional(
      Schema.Struct({
        gas: Schema.optional(Schema.String),
        gasPrice: Schema.optional(Schema.String),
        maxFeePerGas: Schema.optional(Schema.String),
        maxPriorityFeePerGas: Schema.optional(Schema.String),
        nonce: Schema.optional(Schema.String),
        type: Schema.optional(Schema.String),
      })
    ),
    updatedAt: Schema.Finite,
    value: Schema.optional(Schema.String),
  })
);

/**
 * Generate a storage key for a transaction.
 */
function makeTxKey(chainId: number, rootHash: string): string {
  return `${TX_KEY_PREFIX}${chainId}:${rootHash}`;
}

/**
 * Parse transaction ID into chainId and rootHash.
 */
function parseTxId(id: string): { chainId: number; rootHash: string } | null {
  const parts = id.split(":");
  if (parts.length !== 2) {
    return null;
  }

  const chainId = Number(parts[0]);
  if (!Number.isInteger(chainId) || String(chainId) !== parts[0] || !parts[1].startsWith("0x")) {
    return null;
  }

  return { chainId, rootHash: parts[1] };
}

/**
 * Read the transaction index from storage.
 */
function readIndex(storage: BrowserStorage): Effect.Effect<string[], TxStoreError> {
  return Effect.gen(function* () {
    const raw = yield* storage.get(INDEX_KEY);
    if (raw === null) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const index = Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.filter((id): id is string => typeof id === "string" && parseTxId(id) !== null)
          ),
        ]
      : [];
    if (!Array.isArray(parsed) || index.length !== parsed.length) {
      yield* writeIndex(storage, index);
    }
    return index;
  });
}

/**
 * Write the transaction index to storage.
 */
function writeIndex(storage: BrowserStorage, index: string[]): Effect.Effect<void, TxStoreError> {
  return storage.set(INDEX_KEY, JSON.stringify(index));
}

/**
 * Read a single transaction from storage.
 * Returns null if not found or if decode fails (quarantines corrupt data).
 */
function readTx(
  storage: BrowserStorage,
  id: string
): Effect.Effect<PersistedTx | null, TxStoreError> {
  return Effect.gen(function* () {
    const parsed = parseTxId(id);
    if (!parsed) {
      return null;
    }

    const key = makeTxKey(parsed.chainId, parsed.rootHash);
    const raw = yield* storage.get(key);
    if (raw === null) {
      return null;
    }

    try {
      const tx: unknown = JSON.parse(raw);
      if (isPersistedTx(tx) && tx.id === id && tx.id === `${tx.chainId}:${tx.rootHash}`) {
        return tx;
      }
    } catch {
      // Invalid JSON follows the same quarantine path as an invalid record.
    }
    const quarantineKey = `${CORRUPT_KEY_PREFIX}${id}:${Date.now()}`;
    yield* storage.set(quarantineKey, raw);
    yield* storage.remove(key);
    return null;
  });
}

/**
 * Write a single transaction to storage.
 */
function writeTx(storage: BrowserStorage, tx: PersistedTx): Effect.Effect<void, TxStoreError> {
  return Effect.gen(function* () {
    const parsed = parseTxId(tx.id);
    if (!parsed) {
      return;
    }

    const key = makeTxKey(parsed.chainId, parsed.rootHash);
    const raw = JSON.stringify(tx);
    yield* storage.set(key, raw);
  });
}

/**
 * Delete a single transaction from storage.
 */
function deleteTx(storage: BrowserStorage, id: string): Effect.Effect<void, TxStoreError> {
  return Effect.gen(function* () {
    const parsed = parseTxId(id);
    if (!parsed) {
      return;
    }

    const key = makeTxKey(parsed.chainId, parsed.rootHash);
    yield* storage.remove(key);
  });
}

/**
 * Prune oldest terminal transactions if maxTxs is exceeded.
 */
function pruneIfNeeded(
  storage: BrowserStorage,
  txs: PersistedTx[],
  maxTxs: number
): Effect.Effect<PersistedTx[], TxStoreError> {
  return Effect.gen(function* () {
    if (txs.length <= maxTxs) {
      return txs;
    }

    // Separate in-flight from terminal
    const inFlight = txs.filter(isInFlightPersistedTx);
    const terminal = txs.filter(
      (tx) => tx.status === "mined" || tx.status === "failed" || tx.status === "cancelled"
    );

    // Sort terminal by updatedAt (oldest first)
    terminal.sort((a, b) => a.updatedAt - b.updatedAt);

    // Calculate how many to prune
    const totalAfterPrune = maxTxs;
    const keepTerminal = Math.max(0, totalAfterPrune - inFlight.length);
    const toPrune = terminal.slice(0, terminal.length - keepTerminal);

    // Delete pruned transactions
    for (const tx of toPrune) {
      yield* deleteTx(storage, tx.id);
    }

    // Return remaining transactions
    const kept = terminal.slice(terminal.length - keepTerminal);
    return [...inFlight, ...kept];
  });
}

/**
 * LocalStorage-based implementation of TxStore.
 * Uses an index to track all transaction IDs for efficient retrieval.
 */
export const makeLocalStorageTxStoreLive = (
  config: LocalStorageTxStoreConfig = {}
): Layer.Layer<TxStore, TxStoreError, BrowserStorage> => {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  return Layer.effect(
    TxStore,
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;

      const loadAllTxs = Effect.gen(function* () {
        const index = yield* readIndex(storage);
        const txs: PersistedTx[] = [];

        for (const id of index) {
          const tx = yield* readTx(storage, id);
          if (tx !== null) {
            txs.push(tx);
          }
        }

        const validIds = txs.map((tx) => tx.id);
        if (validIds.length !== index.length) {
          yield* writeIndex(storage, validIds);
        }

        return txs;
      });

      const initialInFlight = yield* loadAllTxs.pipe(
        Effect.map((txs) => txs.filter(isInFlightPersistedTx))
      );
      const inFlightRef = yield* SubscriptionRef.make(initialInFlight);
      const changesRef = yield* SubscriptionRef.make<Option.Option<TxStoreChange>>(Option.none());

      const refreshInFlight = loadAllTxs.pipe(
        Effect.map((txs) => txs.filter(isInFlightPersistedTx)),
        Effect.flatMap((txs) => SubscriptionRef.set(inFlightRef, txs))
      );

      const publishChange = (change: TxStoreChange) =>
        SubscriptionRef.set(changesRef, Option.some(change));

      return TxStore.of({
        changes: Stream.filter(SubscriptionRef.changes(changesRef), Option.isSome).pipe(
          Stream.map((change) => change.value)
        ),

        delete: (id: string) =>
          Effect.gen(function* () {
            const previous = yield* readTx(storage, id);

            // Delete the transaction
            yield* deleteTx(storage, id);

            // Remove from index
            const index = yield* readIndex(storage);
            const newIndex = index.filter((txId) => txId !== id);
            yield* writeIndex(storage, newIndex);

            yield* refreshInFlight;
            yield* publishChange({
              _tag: "delete",
              at: Date.now(),
              id,
              previous,
            });
          }),

        get: (id: string) => readTx(storage, id),
        getAll: () => loadAllTxs,

        getInFlight: () => loadAllTxs.pipe(Effect.map((txs) => txs.filter(isInFlightPersistedTx))),

        upsert: (tx: PersistedTx) =>
          Effect.gen(function* () {
            const previous = yield* readTx(storage, tx.id);

            // Write the transaction
            yield* writeTx(storage, tx);

            // Update index
            const index = yield* readIndex(storage);
            if (!index.includes(tx.id)) {
              index.push(tx.id);
              yield* writeIndex(storage, index);
            }

            // Load all transactions for pruning
            const allTxs = yield* loadAllTxs;

            // Prune if needed
            const prunedTxs = yield* pruneIfNeeded(storage, allTxs, finalConfig.maxTxs);
            const prunedIds = prunedTxs.map((t) => t.id);

            // Write updated index
            yield* writeIndex(storage, prunedIds);

            yield* SubscriptionRef.set(
              inFlightRef,
              prunedTxs.filter((persistedTx) => isInFlightPersistedTx(persistedTx))
            );
            yield* publishChange({
              _tag: "upsert",
              at: Date.now(),
              next: tx,
              previous,
            });
          }),

        watchInFlight: () => SubscriptionRef.changes(inFlightRef),
      });
    })
  );
};

/**
 * LocalStorage-based TxStore layer with default configuration.
 */
export const LocalStorageTxStoreLive = makeLocalStorageTxStoreLive();
