import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  BrowserStorage,
  StorageDecodeError,
  StorageQuotaExceededError,
  StorageUnavailableError,
} from "@/src/platform/browser/storage/index.js";

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
      get: (key: string) =>
        Effect.try({
          catch: (error) => {
            if (error instanceof StorageUnavailableError) {
              return error;
            }
            if (error instanceof Error && error.name === "SecurityError") {
              return new StorageUnavailableError({
                message: `localStorage access denied: ${error.message}`,
              });
            }
            return new StorageDecodeError({
              cause: error,
              key,
              message: "Failed to retrieve value from localStorage",
            });
          },
          try: () => mockStorage.getItem(key),
        }),

      remove: (key: string) =>
        Effect.try({
          catch: (error) => {
            if (error instanceof StorageUnavailableError) {
              return error;
            }
            if (error instanceof Error && error.name === "SecurityError") {
              return new StorageUnavailableError({
                message: `localStorage access denied: ${error.message}`,
              });
            }
            return new StorageDecodeError({
              cause: error,
              key,
              message: "Failed to remove value from localStorage",
            });
          },
          try: () => mockStorage.removeItem(key),
        }),

      set: (key: string, value: string) =>
        Effect.try({
          catch: (error) => {
            if (error instanceof StorageUnavailableError) {
              return error;
            }
            if (
              error instanceof Error &&
              (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
            ) {
              return new StorageQuotaExceededError({
                key,
                message: "Storage quota exceeded",
              });
            }
            if (error instanceof Error && error.name === "SecurityError") {
              return new StorageUnavailableError({
                message: `localStorage access denied: ${error.message}`,
              });
            }
            return new StorageDecodeError({
              cause: error,
              key,
              message: "Failed to store value in localStorage",
            });
          },
          try: () => mockStorage.setItem(key, value),
        }),
    })
  );

describe("BrowserStorage", () => {
  it.effect("get returns null for non-existent keys", () =>
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;
      const result = yield* storage.get("non-existent-key");
      expect(result).toBeNull();
    }).pipe(Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage())))
  );

  it.effect("set and get round-trip", () =>
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;

      // Set a value
      yield* storage.set("test-key", "test-value");

      // Get the value back
      const result = yield* storage.get("test-key");
      expect(result).toBe("test-value");
    }).pipe(Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage())))
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
    }).pipe(Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage())))
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
    }).pipe(Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage())))
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
    }).pipe(Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage())))
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
      const result = yield* storage.set("test-key", "test-value").pipe(Effect.either);

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(StorageQuotaExceededError);
        if (result.left._tag === "StorageQuotaExceededError") {
          expect(result.left.key).toBe("test-key");
        }
      }
    }).pipe(Effect.provide(makeMockBrowserStorageLayer(mockStorage)));
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
      const result = yield* storage.get("test-key").pipe(Effect.either);

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(StorageUnavailableError);
      }
    }).pipe(Effect.provide(makeMockBrowserStorageLayer(mockStorage)));
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
      const result = yield* storage.get("test-key").pipe(Effect.either);

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(StorageDecodeError);
        if (result.left._tag === "StorageDecodeError") {
          expect(result.left.key).toBe("test-key");
        }
      }
    }).pipe(Effect.provide(makeMockBrowserStorageLayer(mockStorage)));
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
    }).pipe(Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage())))
  );

  it.effect("handles empty string values", () =>
    Effect.gen(function* () {
      const storage = yield* BrowserStorage;

      // Store empty string
      yield* storage.set("empty-key", "");

      // Should retrieve empty string, not null
      const result = yield* storage.get("empty-key");
      expect(result).toBe("");
    }).pipe(Effect.provide(makeMockBrowserStorageLayer(makeMockLocalStorage())))
  );
});
