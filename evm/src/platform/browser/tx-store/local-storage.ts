import { Effect, Layer } from "effect";
import { BrowserStorage } from "../storage/index.js";
import type { TxStoreError } from "./errors.js";
import { TxStore } from "./store.js";
import type { PersistedTx } from "./types.js";

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

  const chainId = Number.parseInt(parts[0], 10);
  if (Number.isNaN(chainId)) {
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

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Index corrupted, reset to empty
      return [];
    }
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
      const tx = JSON.parse(raw) as PersistedTx;
      return tx;
    } catch (_error) {
      // Quarantine corrupt data
      const quarantineKey = `${CORRUPT_KEY_PREFIX}${id}:${Date.now()}`;
      yield* storage.set(quarantineKey, raw);
      yield* storage.remove(key);
      return null;
    }
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
    const inFlight = txs.filter((tx) => tx.status === "submitted" || tx.status === "pending");
    const terminal = txs.filter((tx) => tx.status === "mined" || tx.status === "failed");

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
): Layer.Layer<TxStore, never, BrowserStorage> => {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  return Layer.effect(
    TxStore,
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;

      return TxStore.of({
        delete: (id: string) =>
          Effect.gen(function* () {
            // Delete the transaction
            yield* deleteTx(storage, id);

            // Remove from index
            const index = yield* readIndex(storage);
            const newIndex = index.filter((txId) => txId !== id);
            yield* writeIndex(storage, newIndex);
          }),

        get: (id: string) => readTx(storage, id),
        getAll: () =>
          Effect.gen(function* () {
            const index = yield* readIndex(storage);
            const txs: PersistedTx[] = [];

            for (const id of index) {
              const tx = yield* readTx(storage, id);
              if (tx !== null) {
                txs.push(tx);
              }
            }

            // Update index to remove any IDs that failed to load
            const validIds = txs.map((tx) => tx.id);
            if (validIds.length !== index.length) {
              yield* writeIndex(storage, validIds);
            }

            return txs;
          }),

        getInFlight: () =>
          Effect.gen(function* () {
            const index = yield* readIndex(storage);
            const inFlight: PersistedTx[] = [];

            for (const id of index) {
              const tx = yield* readTx(storage, id);
              if (tx !== null && (tx.status === "submitted" || tx.status === "pending")) {
                inFlight.push(tx);
              }
            }

            return inFlight;
          }),

        upsert: (tx: PersistedTx) =>
          Effect.gen(function* () {
            // Write the transaction
            yield* writeTx(storage, tx);

            // Update index
            const index = yield* readIndex(storage);
            if (!index.includes(tx.id)) {
              index.push(tx.id);
            }

            // Load all transactions for pruning
            const allTxs: PersistedTx[] = [];
            for (const id of index) {
              const loadedTx = yield* readTx(storage, id);
              if (loadedTx !== null) {
                allTxs.push(loadedTx);
              }
            }

            // Prune if needed
            const prunedTxs = yield* pruneIfNeeded(storage, allTxs, finalConfig.maxTxs);
            const prunedIds = prunedTxs.map((t) => t.id);

            // Write updated index
            yield* writeIndex(storage, prunedIds);
          }),
      });
    })
  );
};

/**
 * LocalStorage-based TxStore layer with default configuration.
 */
export const LocalStorageTxStoreLive = makeLocalStorageTxStoreLive();
