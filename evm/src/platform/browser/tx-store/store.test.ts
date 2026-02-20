import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { mainnet, polygon } from "viem/chains";
import { BrowserStorage } from "#src/platform/browser/storage/index.js";
import type { PersistedTx } from "#src/platform/browser/tx-store/index.js";
import {
  InMemoryTxStoreLive,
  makeLocalStorageTxStoreLive,
  TxStore,
} from "#src/platform/browser/tx-store/index.js";
import { TEST_TX_HASH } from "#src/testing-kit/index.js";

/**
 * Mock localStorage implementation for testing.
 */
const makeMockLocalStorage = (): Storage => {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, v);
    },
  };
};

/**
 * Create a mock BrowserStorage layer backed by a mock localStorage.
 */
const makeMockBrowserStorageLayer = (mockStorage: Storage) =>
  Layer.succeed(
    BrowserStorage,
    BrowserStorage.of({
      get: (key: string) => Effect.succeed(mockStorage.getItem(key)),
      remove: (key: string) => Effect.sync(() => mockStorage.removeItem(key)),
      set: (key: string, value: string) => Effect.sync(() => mockStorage.setItem(key, value)),
    })
  );

/**
 * Helper to create a test transaction.
 */
const makeTestTx = (overrides?: Partial<PersistedTx>): PersistedTx => ({
  chainId: mainnet.id,
  createdAt: Date.now(),
  currentHash: TEST_TX_HASH,
  id: `${mainnet.id}:${TEST_TX_HASH}`,
  replacements: [],
  rootHash: TEST_TX_HASH,
  status: "submitted",
  updatedAt: Date.now(),
  ...overrides,
});

describe("InMemoryTxStore", () => {
  it.effect("getAll returns empty array initially", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;
      const txs = yield* store.getAll();
      expect(txs).toEqual([]);
    }).pipe(Effect.provide(InMemoryTxStoreLive))
  );

  it.effect("upsert adds transaction", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;
      const tx = makeTestTx();

      // Upsert transaction
      yield* store.upsert(tx);

      // Verify it exists
      const retrieved = yield* store.get(tx.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(tx.id);
      expect(retrieved?.status).toBe("submitted");
    }).pipe(Effect.provide(InMemoryTxStoreLive))
  );

  it.effect("get returns null for non-existent ID", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;
      const result = yield* store.get("non-existent-id");
      expect(result).toBeNull();
    }).pipe(Effect.provide(InMemoryTxStoreLive))
  );

  it.effect("upsert updates existing transaction", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;
      const tx = makeTestTx();

      // Insert initial version
      yield* store.upsert(tx);

      // Update with new status
      const updated = { ...tx, status: "mined" as const };
      yield* store.upsert(updated);

      // Verify update
      const retrieved = yield* store.get(tx.id);
      expect(retrieved?.status).toBe("mined");
    }).pipe(Effect.provide(InMemoryTxStoreLive))
  );

  it.effect("delete removes transaction", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;
      const tx = makeTestTx();

      // Insert transaction
      yield* store.upsert(tx);

      // Verify it exists
      const before = yield* store.get(tx.id);
      expect(before).not.toBeNull();

      // Delete transaction
      yield* store.delete(tx.id);

      // Verify it's gone
      const after = yield* store.get(tx.id);
      expect(after).toBeNull();
    }).pipe(Effect.provide(InMemoryTxStoreLive))
  );

  it.effect("getInFlight returns submitted, pending, and queued transactions", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;

      const tx1 = makeTestTx({
        id: "1:0xAAA",
        rootHash: "0xAAA",
        status: "submitted",
      });
      const tx2 = makeTestTx({
        id: "1:0xBBB",
        rootHash: "0xBBB",
        status: "pending",
      });
      const tx3 = makeTestTx({
        id: "1:0xCCC",
        rootHash: "0xCCC",
        status: "queued",
      });
      const tx4 = makeTestTx({
        id: "1:0xDDD",
        rootHash: "0xDDD",
        status: "mined",
      });
      const tx5 = makeTestTx({
        id: "1:0xEEE",
        rootHash: "0xEEE",
        status: "failed",
      });

      // Insert all transactions
      yield* store.upsert(tx1);
      yield* store.upsert(tx2);
      yield* store.upsert(tx3);
      yield* store.upsert(tx4);
      yield* store.upsert(tx5);

      const inFlight = yield* store.getInFlight();

      expect(inFlight).toHaveLength(3);
      expect(inFlight.map((tx) => tx.id).sort()).toEqual(["1:0xAAA", "1:0xBBB", "1:0xCCC"]);
    }).pipe(Effect.provide(InMemoryTxStoreLive))
  );

  it.effect("getAll returns all transactions", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;

      const tx1 = makeTestTx({ id: "1:0xAAA", rootHash: "0xAAA" });
      const tx2 = makeTestTx({ id: "1:0xBBB", rootHash: "0xBBB" });
      const tx3 = makeTestTx({ id: "1:0xCCC", rootHash: "0xCCC" });

      // Insert transactions
      yield* store.upsert(tx1);
      yield* store.upsert(tx2);
      yield* store.upsert(tx3);

      // Get all
      const all = yield* store.getAll();

      expect(all).toHaveLength(3);
      expect(all.map((tx) => tx.id).sort()).toEqual(["1:0xAAA", "1:0xBBB", "1:0xCCC"]);
    }).pipe(Effect.provide(InMemoryTxStoreLive))
  );

  it.effect("handles multiple operations sequentially", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;

      const tx1 = makeTestTx({ id: "1:0xAAA", rootHash: "0xAAA" });
      const tx2 = makeTestTx({ id: "1:0xBBB", rootHash: "0xBBB" });

      // Insert tx1
      yield* store.upsert(tx1);
      expect((yield* store.getAll()).length).toBe(1);

      // Insert tx2
      yield* store.upsert(tx2);
      expect((yield* store.getAll()).length).toBe(2);

      // Update tx1
      yield* store.upsert({ ...tx1, status: "mined" });
      expect((yield* store.get(tx1.id))?.status).toBe("mined");

      // Delete tx2
      yield* store.delete(tx2.id);
      expect((yield* store.getAll()).length).toBe(1);
      expect(yield* store.get(tx2.id)).toBeNull();
    }).pipe(Effect.provide(InMemoryTxStoreLive))
  );
});

describe("LocalStorageTxStore", () => {
  it.effect("basic CRUD operations", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;
      const tx = makeTestTx();

      // Create
      yield* store.upsert(tx);

      // Read
      const retrieved = yield* store.get(tx.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(tx.id);

      // Update
      const updated = { ...tx, status: "mined" as const };
      yield* store.upsert(updated);
      const afterUpdate = yield* store.get(tx.id);
      expect(afterUpdate?.status).toBe("mined");

      // Delete
      yield* store.delete(tx.id);
      const afterDelete = yield* store.get(tx.id);
      expect(afterDelete).toBeNull();
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive()),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("index management: adds new transaction to index", () => {
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      const store = yield* TxStore;

      const tx = makeTestTx();
      yield* store.upsert(tx);

      // Verify index was created
      const indexRaw = mockStorage.getItem("ew3:v1:tx:index");
      expect(indexRaw).not.toBeNull();

      const index = JSON.parse(indexRaw as string);
      expect(index).toContain(tx.id);
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive()),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });

  it.effect("index management: removes deleted transaction from index", () => {
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      const store = yield* TxStore;

      const tx = makeTestTx();
      yield* store.upsert(tx);
      yield* store.delete(tx.id);

      // Verify index was updated
      const indexRaw = mockStorage.getItem("ew3:v1:tx:index");
      const index = JSON.parse(indexRaw as string);
      expect(index).not.toContain(tx.id);
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive()),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });

  it.effect("pruning: keeps all transactions when below maxTxs", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;

      // Create 5 transactions (below limit of 10)
      for (let i = 0; i < 5; i++) {
        const tx = makeTestTx({
          id: `1:0x${i.toString().padStart(64, "0")}`,
          rootHash: `0x${i.toString().padStart(64, "0")}`,
        });
        yield* store.upsert(tx);
      }

      // All should be retained
      const all = yield* store.getAll();
      expect(all).toHaveLength(5);
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive({ maxTxs: 10 })),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("pruning: removes oldest terminal transactions when maxTxs exceeded", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;

      const now = Date.now();

      // Create 3 old mined transactions
      for (let i = 0; i < 3; i++) {
        const tx = makeTestTx({
          createdAt: now - 3000 + i * 100,
          id: `1:0x${i.toString().padStart(64, "0")}`,
          rootHash: `0x${i.toString().padStart(64, "0")}`,
          status: "mined",
          updatedAt: now - 3000 + i * 100,
        });
        yield* store.upsert(tx);
      }

      // Create 2 in-flight transactions
      for (let i = 3; i < 5; i++) {
        const tx = makeTestTx({
          createdAt: now - 1000,
          id: `1:0x${i.toString().padStart(64, "0")}`,
          rootHash: `0x${i.toString().padStart(64, "0")}`,
          status: "submitted",
          updatedAt: now - 1000,
        });
        yield* store.upsert(tx);
      }

      // Create 3 more mined transactions (exceeds limit of 5)
      for (let i = 5; i < 8; i++) {
        const tx = makeTestTx({
          createdAt: now,
          id: `1:0x${i.toString().padStart(64, "0")}`,
          rootHash: `0x${i.toString().padStart(64, "0")}`,
          status: "mined",
          updatedAt: now,
        });
        yield* store.upsert(tx);
      }

      // Should keep 2 in-flight + 3 newest mined = 5 total
      const all = yield* store.getAll();
      expect(all).toHaveLength(5);

      // Verify in-flight txs are retained
      const inFlight = yield* store.getInFlight();
      expect(inFlight).toHaveLength(2);

      // Oldest mined should be pruned (txs 0, 1, 2)
      for (let i = 0; i < 3; i++) {
        const tx = yield* store.get(`1:0x${i.toString().padStart(64, "0")}`);
        expect(tx).toBeNull();
      }
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive({ maxTxs: 5 })),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("pruning: treats cancelled transactions as terminal", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;
      const now = Date.now();

      const cancelledOldHash = `0x${"a".padStart(64, "0")}` as `0x${string}`;
      const cancelledNewHash = `0x${"b".padStart(64, "0")}` as `0x${string}`;
      const submittedHash = `0x${"c".padStart(64, "0")}` as `0x${string}`;
      const cancelledOldId = `1:${cancelledOldHash}`;
      const cancelledNewId = `1:${cancelledNewHash}`;
      const submittedId = `1:${submittedHash}`;

      yield* store.upsert(
        makeTestTx({
          createdAt: now - 2000,
          id: cancelledOldId,
          rootHash: cancelledOldHash,
          status: "cancelled",
          updatedAt: now - 2000,
        })
      );
      yield* store.upsert(
        makeTestTx({
          createdAt: now - 1000,
          id: submittedId,
          rootHash: submittedHash,
          status: "submitted",
          updatedAt: now - 1000,
        })
      );
      yield* store.upsert(
        makeTestTx({
          createdAt: now,
          id: cancelledNewId,
          rootHash: cancelledNewHash,
          status: "cancelled",
          updatedAt: now,
        })
      );

      const all = yield* store.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((tx) => tx.id).sort()).toEqual([cancelledNewId, submittedId].sort());

      const oldCancelled = yield* store.get(cancelledOldId);
      expect(oldCancelled).toBeNull();
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive({ maxTxs: 2 })),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("pruning: preserves all in-flight transactions even if exceeds maxTxs", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;

      // Create 10 in-flight transactions (exceeds limit of 5)
      for (let i = 0; i < 10; i++) {
        const tx = makeTestTx({
          id: `1:0x${i.toString().padStart(64, "0")}`,
          rootHash: `0x${i.toString().padStart(64, "0")}`,
          status: i % 2 === 0 ? "submitted" : "pending",
        });
        yield* store.upsert(tx);
      }

      // All in-flight should be retained despite exceeding maxTxs
      const inFlight = yield* store.getInFlight();
      expect(inFlight).toHaveLength(10);

      const all = yield* store.getAll();
      expect(all).toHaveLength(10);
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive({ maxTxs: 5 })),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("handles corrupt transaction data gracefully", () => {
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      // Manually insert corrupt data with valid index
      mockStorage.setItem("ew3:v1:tx:1:0xABC", "not-valid-json{{{");
      mockStorage.setItem("ew3:v1:tx:index", JSON.stringify(["1:0xABC"]));

      const store = yield* TxStore;

      // getAll should handle corrupt data and clean up index
      const txs = yield* store.getAll();
      expect(txs).toHaveLength(0);

      // Verify corrupt data was quarantined
      const keys: string[] = [];
      for (let i = 0; i < mockStorage.length; i++) {
        const key = mockStorage.key(i);
        if (key !== null) {
          keys.push(key);
        }
      }
      const corruptKeys = keys.filter((k) => k.startsWith("ew3:v1:tx:corrupt:"));
      expect(corruptKeys.length).toBeGreaterThan(0);
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive()),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });

  it.effect("getInFlight filters correctly", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;

      // Create transactions with different statuses
      const txSubmitted = makeTestTx({
        id: "1:0xAAA",
        rootHash: "0xAAA",
        status: "submitted",
      });
      const txPending = makeTestTx({
        id: "1:0xBBB",
        rootHash: "0xBBB",
        status: "pending",
      });
      const txQueued = makeTestTx({
        id: "1:0xCCC",
        rootHash: "0xCCC",
        status: "queued",
      });
      const txCancelled = makeTestTx({
        id: "1:0xDDD",
        rootHash: "0xDDD",
        status: "cancelled",
      });
      const txFailed = makeTestTx({
        id: "1:0xEEE",
        rootHash: "0xEEE",
        status: "failed",
      });

      yield* store.upsert(txSubmitted);
      yield* store.upsert(txPending);
      yield* store.upsert(txQueued);
      yield* store.upsert(txCancelled);
      yield* store.upsert(txFailed);

      // Get in-flight
      const inFlight = yield* store.getInFlight();

      expect(inFlight).toHaveLength(3);
      expect(inFlight.map((tx) => tx.status).sort()).toEqual(["pending", "queued", "submitted"]);
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive()),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("handles transaction metadata", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;

      const tx = makeTestTx({
        data: "0x1234",
        description: "Test transaction",
        from: "0xSender",
        tags: ["tag1", "tag2"],
        to: "0xRecipient",
        txMeta: {
          gas: "21000",
          gasPrice: "1000000000",
          nonce: "42",
          type: "0",
        },
        value: "1000000000000000000",
      });

      yield* store.upsert(tx);

      const retrieved = yield* store.get(tx.id);
      expect(retrieved?.description).toBe("Test transaction");
      expect(retrieved?.tags).toEqual(["tag1", "tag2"]);
      expect(retrieved?.txMeta?.gas).toBe("21000");
      expect(retrieved?.from).toBe("0xSender");
      expect(retrieved?.to).toBe("0xRecipient");
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive()),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("handles transaction replacements", () =>
    Effect.gen(function* () {
      const store = yield* TxStore;

      const tx = makeTestTx({
        replacements: [
          {
            at: Date.now(),
            newHash: "0xNEW",
            oldHash: "0xOLD",
            reason: "repriced",
          },
        ],
      });

      yield* store.upsert(tx);

      const retrieved = yield* store.get(tx.id);
      expect(retrieved?.replacements).toHaveLength(1);
      expect(retrieved?.replacements[0].reason).toBe("repriced");
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive()),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("correctly formats storage keys", () => {
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      const store = yield* TxStore;

      const tx = makeTestTx({
        chainId: polygon.id,
        id: `${polygon.id}:0xABC123`,
        rootHash: "0xABC123",
      });
      yield* store.upsert(tx);

      // Verify key format
      const key = `ew3:v1:tx:${polygon.id}:0xABC123`;
      const value = mockStorage.getItem(key);
      expect(value).not.toBeNull();
    }).pipe(
      Effect.provide(makeLocalStorageTxStoreLive()),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });
});
