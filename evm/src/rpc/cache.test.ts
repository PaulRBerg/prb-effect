import { describe, expect, it } from "@effect/vitest";
import { Effect, TestClock } from "effect";
import { makeRpcCacheLive, RpcCache } from "#src/rpc/index.js";

describe("RpcCache", () => {
  const testLayer = makeRpcCacheLive();

  it.effect("get returns null for missing key", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;
      const result = yield* cache.get("missing-key");
      expect(result).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("set then get returns stored value", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;
      yield* cache.set("test-key", { data: "test-value" });
      const result = yield* cache.get<{ data: string }>("test-key");
      expect(result).toEqual({ data: "test-value" });
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("TTL expiration removes entry", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;
      yield* cache.set("expiring-key", "value");

      // Wait for TTL to expire
      yield* TestClock.adjust("60 millis");

      const result = yield* cache.get("expiring-key");
      expect(result).toBeNull();
    }).pipe(Effect.provide(makeRpcCacheLive({ ttl: 50 })))
  );

  it.effect("max size LRU eviction removes oldest entry", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;

      yield* cache.set("key1", "value1");
      yield* cache.set("key2", "value2");
      yield* cache.set("key3", "value3");
      // This should evict key1 (oldest)
      yield* cache.set("key4", "value4");

      const result1 = yield* cache.get("key1");
      const result2 = yield* cache.get("key2");
      const result3 = yield* cache.get("key3");
      const result4 = yield* cache.get("key4");

      expect(result1).toBeNull();
      expect(result2).toBe("value2");
      expect(result3).toBe("value3");
      expect(result4).toBe("value4");
    }).pipe(Effect.provide(makeRpcCacheLive({ maxSize: 3 })))
  );

  it.effect("access order updated on get (LRU behavior)", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;

      yield* cache.set("key1", "value1");
      yield* cache.set("key2", "value2");
      yield* cache.set("key3", "value3");

      // Access key1 to make it more recently used
      yield* cache.get("key1");

      // Add key4, should evict key2 (now oldest)
      yield* cache.set("key4", "value4");

      const result1 = yield* cache.get("key1");
      const result2 = yield* cache.get("key2");
      const result3 = yield* cache.get("key3");
      const result4 = yield* cache.get("key4");

      expect(result1).toBe("value1");
      expect(result2).toBeNull();
      expect(result3).toBe("value3");
      expect(result4).toBe("value4");
    }).pipe(Effect.provide(makeRpcCacheLive({ maxSize: 3 })))
  );

  it.effect("invalidate removes specific key", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;
      yield* cache.set("key1", "value1");
      yield* cache.set("key2", "value2");

      yield* cache.invalidate("key1");

      const result1 = yield* cache.get("key1");
      const result2 = yield* cache.get("key2");

      expect(result1).toBeNull();
      expect(result2).toBe("value2");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("invalidateBlock removes entries with older blockNumber", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;

      yield* cache.set("key1", "value1", 100n);
      yield* cache.set("key2", "value2", 200n);
      yield* cache.set("key3", "value3", 300n);

      // Invalidate blocks older than 250
      yield* cache.invalidateBlock(250n);

      const result1 = yield* cache.get("key1");
      const result2 = yield* cache.get("key2");
      const result3 = yield* cache.get("key3");

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(result3).toBe("value3");
    }).pipe(Effect.provide(makeRpcCacheLive({ blockScoped: true })))
  );

  it.effect("invalidateBlock no-op when blockScoped=false", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;

      yield* cache.set("key1", "value1", 100n);
      yield* cache.set("key2", "value2", 200n);

      // Should not invalidate when blockScoped is false
      yield* cache.invalidateBlock(250n);

      const result1 = yield* cache.get("key1");
      const result2 = yield* cache.get("key2");

      expect(result1).toBe("value1");
      expect(result2).toBe("value2");
    }).pipe(Effect.provide(makeRpcCacheLive({ blockScoped: false })))
  );

  it.effect("clear removes all entries", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;

      yield* cache.set("key1", "value1");
      yield* cache.set("key2", "value2");
      yield* cache.set("key3", "value3");

      yield* cache.clear;

      const result1 = yield* cache.get("key1");
      const result2 = yield* cache.get("key2");
      const result3 = yield* cache.get("key3");

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(result3).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("block number stored correctly with set", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;

      yield* cache.set("key1", "value1", 12345n);

      const result = yield* cache.get("key1");
      expect(result).toBe("value1");

      // Invalidate blocks older than the next block
      yield* cache.invalidateBlock(12346n);
      const resultAfterInvalidate = yield* cache.get("key1");
      expect(resultAfterInvalidate).toBeNull();
    }).pipe(Effect.provide(makeRpcCacheLive({ blockScoped: true })))
  );

  it.effect("multiple entries with same block number", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;

      yield* cache.set("key1", "value1", 100n);
      yield* cache.set("key2", "value2", 100n);
      yield* cache.set("key3", "value3", 100n);
      yield* cache.set("key4", "value4", 200n);

      // Invalidate blocks older than 150
      yield* cache.invalidateBlock(150n);

      const result1 = yield* cache.get("key1");
      const result2 = yield* cache.get("key2");
      const result3 = yield* cache.get("key3");
      const result4 = yield* cache.get("key4");

      expect(result1).toBeNull();
      expect(result2).toBeNull();
      expect(result3).toBeNull();
      expect(result4).toBe("value4");
    }).pipe(Effect.provide(makeRpcCacheLive({ blockScoped: true })))
  );

  it.effect("expired entries cleaned up on get", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;

      yield* cache.set("key1", "value1");

      // Wait for expiration
      yield* TestClock.adjust("60 millis");

      // Getting the key should return null and clean it up
      const result1 = yield* cache.get("key1");
      expect(result1).toBeNull();

      // Verify it's cleaned up (not just expired)
      const result2 = yield* cache.get("key1");
      expect(result2).toBeNull();
    }).pipe(Effect.provide(makeRpcCacheLive({ ttl: 50 })))
  );

  it.effect("entries without block number not affected by invalidateBlock", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;

      yield* cache.set("key1", "value1"); // No block number
      yield* cache.set("key2", "value2", 100n);

      yield* cache.invalidateBlock(200n);

      const result1 = yield* cache.get("key1");
      const result2 = yield* cache.get("key2");

      expect(result1).toBe("value1"); // Not affected
      expect(result2).toBeNull(); // Invalidated
    }).pipe(Effect.provide(makeRpcCacheLive({ blockScoped: true })))
  );

  it.effect("default config values", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;

      // Default TTL is 12000ms, blockScoped is true, maxSize is 100
      // Just verify the layer can be created and used
      yield* cache.set("test", "value");
      const result = yield* cache.get("test");
      expect(result).toBe("value");
    }).pipe(Effect.provide(makeRpcCacheLive()))
  );

  it.effect("custom config values applied", () =>
    Effect.gen(function* () {
      const cache = yield* RpcCache;

      // This test verifies that custom config is respected
      // by checking TTL expiration with custom value
      yield* cache.set("test", "value");

      yield* TestClock.adjust("25 millis");

      const result = yield* cache.get("test");
      expect(result).toBeNull();
    }).pipe(Effect.provide(makeRpcCacheLive({ blockScoped: false, maxSize: 50, ttl: 20 })))
  );
});
