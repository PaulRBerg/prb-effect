import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import {
  BrowserStorage,
  BrowserStorageLive,
  StorageDecodeError,
  StorageQuotaExceededError,
  StorageUnavailableError,
} from "#src/platform/browser/storage/index.js";

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

function makeBrowserStorageLayer(mockStorage: Storage) {
  vi.stubGlobal("window", { localStorage: mockStorage });
  return BrowserStorageLive;
}

afterEach(() => vi.unstubAllGlobals());

describe("BrowserStorage", () => {
  it.effect("get returns null for non-existent keys", () =>
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;
      const result = yield* storage.get("non-existent-key");
      expect(result).toBeNull();
    }).pipe(Effect.provide(makeBrowserStorageLayer(makeMockLocalStorage())))
  );

  it.effect("set and get round-trip", () =>
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;

      // Set a value
      yield* storage.set("test-key", "test-value");

      // Get the value back
      const result = yield* storage.get("test-key");
      expect(result).toBe("test-value");
    }).pipe(Effect.provide(makeBrowserStorageLayer(makeMockLocalStorage())))
  );

  it.effect("remove deletes keys", () =>
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;

      // Set a value
      yield* storage.set("test-key", "test-value");

      // Verify it exists
      const before = yield* storage.get("test-key");
      expect(before).toBe("test-value");

      // Remove it
      yield* storage.remove("test-key");

      // Verify it's gone
      const after = yield* storage.get("test-key");
      expect(after).toBeNull();
    }).pipe(Effect.provide(makeBrowserStorageLayer(makeMockLocalStorage())))
  );

  it.effect("handles multiple keys independently", () =>
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;

      // Set multiple keys
      yield* storage.set("key1", "value1");
      yield* storage.set("key2", "value2");
      yield* storage.set("key3", "value3");

      // Verify all exist
      expect(yield* storage.get("key1")).toBe("value1");
      expect(yield* storage.get("key2")).toBe("value2");
      expect(yield* storage.get("key3")).toBe("value3");

      // Remove one
      yield* storage.remove("key2");

      // Verify others remain
      expect(yield* storage.get("key1")).toBe("value1");
      expect(yield* storage.get("key2")).toBeNull();
      expect(yield* storage.get("key3")).toBe("value3");
    }).pipe(Effect.provide(makeBrowserStorageLayer(makeMockLocalStorage())))
  );

  it.effect("overwrites existing values", () =>
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;

      // Set initial value
      yield* storage.set("test-key", "initial-value");
      expect(yield* storage.get("test-key")).toBe("initial-value");

      // Overwrite with new value
      yield* storage.set("test-key", "updated-value");
      expect(yield* storage.get("test-key")).toBe("updated-value");
    }).pipe(Effect.provide(makeBrowserStorageLayer(makeMockLocalStorage())))
  );

  it.effect("handles StorageQuotaExceededError", () => {
    // Create mock storage that throws quota error
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      mockStorage.setItem = () => {
        const error = new Error("Quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      };

      const storage = yield* BrowserStorage;

      // Attempt to set should fail with quota error
      const result = yield* storage.set("test-key", "test-value").pipe(Effect.result);

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure).toBeInstanceOf(StorageQuotaExceededError);
        if (result.failure._tag === "StorageQuotaExceededError") {
          expect(result.failure.key).toBe("test-key");
        }
      }
    }).pipe(Effect.provide(makeBrowserStorageLayer(mockStorage)));
  });

  it.effect("handles SecurityError as StorageUnavailableError", () => {
    // Create mock storage that throws security error
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      mockStorage.getItem = () => {
        const error = new Error("Access denied");
        error.name = "SecurityError";
        throw error;
      };

      const storage = yield* BrowserStorage;

      // Attempt to get should fail with unavailable error
      const result = yield* storage.get("test-key").pipe(Effect.result);

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure).toBeInstanceOf(StorageUnavailableError);
      }
    }).pipe(Effect.provide(makeBrowserStorageLayer(mockStorage)));
  });

  it.effect("handles unknown errors as StorageDecodeError", () => {
    // Create mock storage that throws unknown error
    const mockStorage = makeMockLocalStorage();
    return Effect.gen(function* () {
      mockStorage.getItem = () => {
        throw new Error("Something unexpected happened");
      };

      const storage = yield* BrowserStorage;

      // Attempt to get should fail with decode error
      const result = yield* storage.get("test-key").pipe(Effect.result);

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure).toBeInstanceOf(StorageDecodeError);
        if (result.failure._tag === "StorageDecodeError") {
          expect(result.failure.key).toBe("test-key");
        }
      }
    }).pipe(Effect.provide(makeBrowserStorageLayer(mockStorage)));
  });

  it.effect("stores and retrieves JSON-encoded data", () =>
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;

      const data = { baz: [1, 2, 3], foo: "bar", nested: { value: 42 } };
      const encoded = JSON.stringify(data);

      // Store JSON string
      yield* storage.set("json-key", encoded);

      // Retrieve and parse
      const retrieved = yield* storage.get("json-key");
      expect(retrieved).not.toBeNull();
      if (retrieved !== null) {
        const decoded = JSON.parse(retrieved);
        expect(decoded).toEqual(data);
      }
    }).pipe(Effect.provide(makeBrowserStorageLayer(makeMockLocalStorage())))
  );

  it.effect("handles empty string values", () =>
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;

      // Store empty string
      yield* storage.set("empty-key", "");

      // Should retrieve empty string, not null
      const result = yield* storage.get("empty-key");
      expect(result).toBe("");
    }).pipe(Effect.provide(makeBrowserStorageLayer(makeMockLocalStorage())))
  );
});
