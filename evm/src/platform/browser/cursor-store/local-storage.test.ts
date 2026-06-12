import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, TestClock } from "effect";
import type { StreamCursor } from "#src/events/index.js";
import { CursorStore } from "#src/events/index.js";
import { LocalStorageCursorStoreLive } from "#src/platform/browser/cursor-store/index.js";
import { BrowserStorage, StorageQuotaExceededError } from "#src/platform/browser/storage/index.js";
import { TEST_ADDRESS, TEST_CHAIN_ID } from "#src/testing-kit/index.js";

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
 * Helper to run effects with TestClock time advancement.
 * Forks the effect, advances the clock, then joins the fiber.
 */
const runWithTime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  adjust: Parameters<typeof TestClock.adjust>[0] = "300 millis"
) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.fork(effect);
    yield* TestClock.adjust(adjust);
    return yield* Fiber.join(fiber);
  });

describe("LocalStorageCursorStore", () => {
  const testCursor: StreamCursor = {
    address: TEST_ADDRESS,
    chainId: TEST_CHAIN_ID,
    eventName: "Transfer",
    lastBlockNumber: 12345678n,
    lastLogIndex: 42,
    updatedAt: Date.now(),
  };

  it.effect("get returns null for non-existent cursors", () =>
    Effect.gen(function* () {
      const store = yield* CursorStore;
      const result = yield* store.get("non-existent-key");
      expect(result).toBeNull();
    }).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("set and get round-trip for StreamCursor", () =>
    runWithTime(
      Effect.gen(function* () {
        const store = yield* CursorStore;
        const key = "test-cursor-key";

        // Set cursor
        yield* store.set(key, testCursor);

        // Wait for the throttled write to complete
        yield* TestClock.adjust("300 millis");

        // Get cursor
        const retrieved = yield* store.get(key);

        expect(retrieved).not.toBeNull();
        if (retrieved !== null) {
          expect(retrieved.address).toBe(testCursor.address);
          expect(retrieved.chainId).toBe(testCursor.chainId);
          expect(retrieved.eventName).toBe(testCursor.eventName);
          expect(retrieved.lastBlockNumber).toBe(testCursor.lastBlockNumber);
          expect(retrieved.lastLogIndex).toBe(testCursor.lastLogIndex);
          expect(retrieved.updatedAt).toBe(testCursor.updatedAt);
        }
      })
    ).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("handles bigint serialization correctly", () =>
    runWithTime(
      Effect.gen(function* () {
        const store = yield* CursorStore;
        const key = "bigint-test";

        const largeCursor: StreamCursor = {
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          eventName: "Transfer",
          lastBlockNumber: 999999999999999999999999n, // Very large bigint
          lastLogIndex: 100,
          updatedAt: Date.now(),
        };

        // Set cursor with large bigint
        yield* store.set(key, largeCursor);

        // Wait for throttled write
        yield* TestClock.adjust("300 millis");

        // Retrieve and verify bigint is preserved
        const retrieved = yield* store.get(key);

        expect(retrieved).not.toBeNull();
        if (retrieved !== null) {
          expect(retrieved.lastBlockNumber).toBe(999999999999999999999999n);
          expect(typeof retrieved.lastBlockNumber).toBe("bigint");
        }
      })
    ).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("delete removes cursor", () =>
    runWithTime(
      Effect.gen(function* () {
        const store = yield* CursorStore;
        const key = "delete-test";

        // Set cursor
        yield* store.set(key, testCursor);

        // Wait for throttled write
        yield* TestClock.adjust("300 millis");

        // Verify it exists
        const before = yield* store.get(key);
        expect(before).not.toBeNull();

        // Delete cursor
        yield* store.delete(key);

        // Verify it's gone
        const after = yield* store.get(key);
        expect(after).toBeNull();
      })
    ).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("handles corrupt data gracefully", () => {
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      // Manually insert corrupt data
      mockStorage.setItem("ew3:v1:cursor:corrupt-key", "not-valid-json{{{");

      const store = yield* CursorStore;

      // Get should return null and delete corrupt entry
      const result = yield* store.get("corrupt-key");
      expect(result).toBeNull();

      // Verify corrupt entry was deleted
      const rawValue = mockStorage.getItem("ew3:v1:cursor:corrupt-key");
      expect(rawValue).toBeNull();
    }).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });

  it.effect("handles incomplete JSON data gracefully", () => {
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      // Insert JSON that's missing required fields
      mockStorage.setItem(
        "ew3:v1:cursor:incomplete-key",
        JSON.stringify({ eventName: "Transfer" })
      );

      const store = yield* CursorStore;

      // Get should return null and delete corrupt entry
      const result = yield* store.get("incomplete-key");
      expect(result).toBeNull();

      // Verify corrupt entry was deleted
      const rawValue = mockStorage.getItem("ew3:v1:cursor:incomplete-key");
      expect(rawValue).toBeNull();
    }).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });

  it.effect("write throttling: multiple sets within 250ms", () => {
    const mockStorage = makeMockLocalStorage();
    return runWithTime(
      Effect.gen(function* () {
        const store = yield* CursorStore;
        const key = "throttle-test";

        // Track number of actual writes to storage
        let writeCount = 0;
        const originalSet = mockStorage.setItem.bind(mockStorage);
        mockStorage.setItem = (k: string, v: string) => {
          if (k === "ew3:v1:cursor:throttle-test") {
            writeCount += 1;
          }
          originalSet(k, v);
        };

        // Perform multiple sets rapidly
        yield* store.set(key, { ...testCursor, lastBlockNumber: 100n });
        yield* store.set(key, { ...testCursor, lastBlockNumber: 200n });
        yield* store.set(key, { ...testCursor, lastBlockNumber: 300n });

        // Should not have written yet (throttled)
        expect(writeCount).toBe(0);

        // Wait for throttle period
        yield* TestClock.adjust("300 millis");

        // Should have written once with latest value
        expect(writeCount).toBe(1);
        const retrieved = yield* store.get(key);
        expect(retrieved?.lastBlockNumber).toBe(300n);
      })
    ).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });

  it.effect("handles multiple cursors independently", () =>
    runWithTime(
      Effect.gen(function* () {
        const store = yield* CursorStore;

        const cursor1: StreamCursor = {
          ...testCursor,
          eventName: "Transfer",
          lastBlockNumber: 100n,
        };
        const cursor2: StreamCursor = {
          ...testCursor,
          eventName: "Approval",
          lastBlockNumber: 200n,
        };
        const cursor3: StreamCursor = {
          ...testCursor,
          eventName: "Mint",
          lastBlockNumber: 300n,
        };

        // Set multiple cursors
        yield* store.set("key1", cursor1);
        yield* store.set("key2", cursor2);
        yield* store.set("key3", cursor3);

        // Wait for throttled writes
        yield* TestClock.adjust("300 millis");

        // Verify all cursors exist independently
        const retrieved1 = yield* store.get("key1");
        const retrieved2 = yield* store.get("key2");
        const retrieved3 = yield* store.get("key3");

        expect(retrieved1?.lastBlockNumber).toBe(100n);
        expect(retrieved2?.lastBlockNumber).toBe(200n);
        expect(retrieved3?.lastBlockNumber).toBe(300n);
      })
    ).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage()))
    )
  );

  it.effect("delete cancels pending write", () => {
    const mockStorage = makeMockLocalStorage();
    return runWithTime(
      Effect.gen(function* () {
        const store = yield* CursorStore;
        const key = "cancel-test";

        // Set cursor (will be throttled)
        yield* store.set(key, testCursor);

        // Delete before throttle period expires
        yield* store.delete(key);

        // Wait for throttle period
        yield* TestClock.adjust("300 millis");

        // Cursor should not exist
        const result = yield* store.get(key);
        expect(result).toBeNull();

        // Storage should not contain the key
        const rawValue = mockStorage.getItem("ew3:v1:cursor:cancel-test");
        expect(rawValue).toBeNull();
      })
    ).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });

  it.effect("set -> delete -> set still persists the final value (no wedge)", () => {
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      const store = yield* CursorStore;
      const key = "wedge-test";

      // First set, let it flush.
      yield* store.set(key, { ...testCursor, lastBlockNumber: 100n });
      yield* TestClock.adjust("300 millis");

      // Delete the key. The original flush has already completed; this clears the
      // slot. The old two-Ref implementation left a stale timer behind here.
      yield* store.delete(key);
      yield* TestClock.adjust("300 millis");

      // A fresh set must still schedule and flush a write.
      yield* store.set(key, { ...testCursor, lastBlockNumber: 500n });
      yield* TestClock.adjust("300 millis");

      const retrieved = yield* store.get(key);
      expect(retrieved?.lastBlockNumber).toBe(500n);
    }).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });

  it.effect("delete during the throttle window does not wedge later writes", () => {
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      const store = yield* CursorStore;
      const key = "wedge-during-window";

      // Set then delete before the flush fires (slot is taken by delete).
      yield* store.set(key, { ...testCursor, lastBlockNumber: 100n });
      yield* store.delete(key);
      yield* TestClock.adjust("300 millis");

      // Nothing should have been written.
      expect(mockStorage.getItem("ew3:v1:cursor:wedge-during-window")).toBeNull();

      // A subsequent set must still flush — the key is not wedged.
      yield* store.set(key, { ...testCursor, lastBlockNumber: 700n });
      yield* TestClock.adjust("300 millis");

      const retrieved = yield* store.get(key);
      expect(retrieved?.lastBlockNumber).toBe(700n);
    }).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });

  it.effect("rapid set during an in-flight flush persists the latest value", () => {
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      const store = yield* CursorStore;
      const key = "reflush-test";

      const writes: bigint[] = [];
      const originalSet = mockStorage.setItem.bind(mockStorage);
      mockStorage.setItem = (k: string, v: string) => {
        if (k === "ew3:v1:cursor:reflush-test") {
          writes.push(JSON.parse(v).lastBlockNumber as unknown as bigint);
        }
        originalSet(k, v);
      };

      // First set flushes at 250ms.
      yield* store.set(key, { ...testCursor, lastBlockNumber: 100n });
      yield* TestClock.adjust("300 millis");

      // A new set after the first flush re-arms a fresh flush for the latest value.
      yield* store.set(key, { ...testCursor, lastBlockNumber: 200n });
      yield* TestClock.adjust("300 millis");

      // Latest value wins and is the last thing written.
      const retrieved = yield* store.get(key);
      expect(retrieved?.lastBlockNumber).toBe(200n);
      expect(writes.at(-1)).toBe("200");
    }).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });

  it.effect("flush storage error is logged and does not wedge the key", () => {
    const mockStorage = makeMockLocalStorage();
    // First set() write fails; subsequent writes succeed.
    let failNext = true;
    const failingStorageLayer = Layer.succeed(
      BrowserStorage,
      BrowserStorage.of({
        get: (key: string) => Effect.succeed(mockStorage.getItem(key)),
        remove: (key: string) => Effect.sync(() => mockStorage.removeItem(key)),
        set: (key: string, value: string) =>
          Effect.suspend(() => {
            if (failNext && key === "ew3:v1:cursor:error-test") {
              failNext = false;
              return Effect.fail(new StorageQuotaExceededError({ key, message: "quota exceeded" }));
            }
            return Effect.sync(() => mockStorage.setItem(key, value));
          }),
      })
    );

    return Effect.gen(function* () {
      const store = yield* CursorStore;
      const key = "error-test";

      // This write fails inside the flush; the failure must be caught/logged,
      // not crash the daemon, and not wedge the key.
      yield* store.set(key, { ...testCursor, lastBlockNumber: 100n });
      yield* TestClock.adjust("300 millis");

      // Nothing persisted yet (the write failed).
      expect(mockStorage.getItem("ew3:v1:cursor:error-test")).toBeNull();

      // A later set must still flush successfully — the key is not wedged.
      yield* store.set(key, { ...testCursor, lastBlockNumber: 900n });
      yield* TestClock.adjust("300 millis");

      const retrieved = yield* store.get(key);
      expect(retrieved?.lastBlockNumber).toBe(900n);
    }).pipe(Effect.provide(LocalStorageCursorStoreLive), Effect.provide(failingStorageLayer));
  });

  it.effect("delete during an in-flight flush write does not resurrect the key", () => {
    const mockStorage = makeMockLocalStorage();
    // storage.set takes 100ms so a delete can land while the write is in flight.
    const slowStorageLayer = Layer.succeed(
      BrowserStorage,
      BrowserStorage.of({
        get: (key: string) => Effect.succeed(mockStorage.getItem(key)),
        remove: (key: string) => Effect.sync(() => mockStorage.removeItem(key)),
        set: (key: string, value: string) =>
          Effect.sleep("100 millis").pipe(
            Effect.zipRight(Effect.sync(() => mockStorage.setItem(key, value)))
          ),
      })
    );

    return Effect.gen(function* () {
      const store = yield* CursorStore;
      const key = "resurrect-test";

      yield* store.set(key, { ...testCursor, lastBlockNumber: 100n });

      // Wake the flush at 250ms: it drains the cursor and enters the slow write
      // (which completes at 350ms).
      yield* TestClock.adjust("250 millis");

      // Delete while the write is in flight. The tombstone makes the flush undo
      // its own write instead of resurrecting the deleted key.
      yield* store.delete(key);
      yield* TestClock.adjust("200 millis");

      expect(mockStorage.getItem("ew3:v1:cursor:resurrect-test")).toBeNull();
      const retrieved = yield* store.get(key);
      expect(retrieved).toBeNull();
    }).pipe(Effect.provide(LocalStorageCursorStoreLive), Effect.provide(slowStorageLayer));
  });

  it.effect("updates to same key reset throttle timer", () => {
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      const store = yield* CursorStore;
      const key = "update-test";

      let writeCount = 0;
      const originalSet = mockStorage.setItem.bind(mockStorage);
      mockStorage.setItem = (k: string, v: string) => {
        if (k === "ew3:v1:cursor:update-test") {
          writeCount += 1;
        }
        originalSet(k, v);
      };

      // First set (timer starts for 250ms from now)
      yield* store.set(key, { ...testCursor, lastBlockNumber: 100n });

      // Wait 100ms (timer at 150ms remaining)
      yield* TestClock.adjust("100 millis");
      expect(writeCount).toBe(0);

      // Second set - updates pending value but reuses existing timer
      yield* store.set(key, { ...testCursor, lastBlockNumber: 200n });

      // Wait 100ms more (timer at 50ms remaining)
      yield* TestClock.adjust("100 millis");
      expect(writeCount).toBe(0);

      // Third set - updates pending value
      yield* store.set(key, { ...testCursor, lastBlockNumber: 300n });

      // Wait 100ms - timer fires (250ms total elapsed)
      yield* TestClock.adjust("100 millis");

      // Should have written once with latest value
      expect(writeCount).toBe(1);
      const retrieved = yield* store.get(key);
      expect(retrieved?.lastBlockNumber).toBe(300n);
    }).pipe(
      Effect.provide(LocalStorageCursorStoreLive),
      Effect.provide(makeMockBrowserStorageLayer(mockStorage))
    );
  });
});
