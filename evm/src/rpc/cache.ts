import { Clock, Context, Effect, Layer, Ref } from "effect";

export type CacheConfig = {
  ttl?: number; // default 12_000ms (1 block)
  maxSize?: number; // default 100 entries
  blockScoped?: boolean; // default true - invalidate on new block
};

export type CacheEntry<T> = {
  value: T;
  timestamp: number;
  blockNumber?: bigint;
  ttl?: number;
};

export type RpcCacheShape = {
  readonly get: <T>(key: string) => Effect.Effect<T | null>;
  readonly set: <T>(
    key: string,
    value: T,
    blockNumber?: bigint,
    ttl?: number
  ) => Effect.Effect<void>;
  readonly invalidate: (key: string) => Effect.Effect<void>;
  readonly invalidateBlock: (blockNumber: bigint) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
};

export class RpcCache extends Context.Tag("ew3/RpcCache")<RpcCache, RpcCacheShape>() {}

/**
 * Create a cache layer with LRU eviction using Effect's Cache module
 */
export const makeRpcCacheLive = (config?: CacheConfig): Layer.Layer<RpcCache> => {
  const defaultTtl = config?.ttl ?? 12_000;
  const maxSize = config?.maxSize ?? 100;
  const blockScoped = config?.blockScoped ?? true;

  return Layer.effect(
    RpcCache,
    Effect.gen(function* () {
      // Store cache entries with timestamps and metadata
      const entriesRef = yield* Ref.make(new Map<string, CacheEntry<unknown>>());
      // Track access order for LRU eviction
      const accessOrderRef = yield* Ref.make(new Map<string, number>());
      const accessCounterRef = yield* Ref.make(0);

      // Evict the least recently used entry when at capacity
      const evictOldest = Effect.gen(function* () {
        const entries = yield* Ref.get(entriesRef);
        const accessOrder = yield* Ref.get(accessOrderRef);

        if (entries.size >= maxSize) {
          // Find the key with the lowest access counter (oldest)
          let oldestKey: string | null = null;
          let oldestAccess = Number.POSITIVE_INFINITY;

          for (const [key, access] of accessOrder.entries()) {
            if (access < oldestAccess) {
              oldestAccess = access;
              oldestKey = key;
            }
          }

          if (oldestKey) {
            const keyToEvict = oldestKey;
            yield* Ref.update(entriesRef, (e) => {
              const newEntries = new Map(e);
              newEntries.delete(keyToEvict);
              return newEntries;
            });
            yield* Ref.update(accessOrderRef, (o) => {
              const newAccessOrder = new Map(o);
              newAccessOrder.delete(keyToEvict);
              return newAccessOrder;
            });
          }
        }
      });

      const get = <T>(key: string): Effect.Effect<T | null> =>
        Effect.gen(function* () {
          const entries = yield* Ref.get(entriesRef);
          const entry = entries.get(key);

          if (!entry) {
            return null;
          }

          // Check TTL expiration
          const now = yield* Clock.currentTimeMillis;
          const entryTtl = entry.ttl ?? defaultTtl;

          if (now - entry.timestamp > entryTtl) {
            // Expired - remove it
            yield* Ref.update(entriesRef, (e) => {
              const newEntries = new Map(e);
              newEntries.delete(key);
              return newEntries;
            });
            yield* Ref.update(accessOrderRef, (o) => {
              const newAccessOrder = new Map(o);
              newAccessOrder.delete(key);
              return newAccessOrder;
            });
            return null;
          }

          // Update access order for LRU
          const accessCounter = yield* Ref.updateAndGet(accessCounterRef, (n) => n + 1);
          yield* Ref.update(accessOrderRef, (o) => {
            const newAccessOrder = new Map(o);
            newAccessOrder.set(key, accessCounter);
            return newAccessOrder;
          });

          return entry.value as T;
        });

      const set = <T>(
        key: string,
        value: T,
        blockNumber?: bigint,
        entryTtl?: number
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;

          // Evict oldest entry if at capacity
          yield* evictOldest;

          // Store entry with timestamp
          yield* Ref.update(entriesRef, (entries) => {
            const newEntries = new Map(entries);
            newEntries.set(key, {
              blockNumber,
              timestamp: now,
              ttl: entryTtl,
              value,
            });
            return newEntries;
          });

          // Update access order for LRU
          const accessCounter = yield* Ref.updateAndGet(accessCounterRef, (n) => n + 1);
          yield* Ref.update(accessOrderRef, (o) => {
            const newAccessOrder = new Map(o);
            newAccessOrder.set(key, accessCounter);
            return newAccessOrder;
          });
        });

      const invalidate = (key: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Ref.update(entriesRef, (entries) => {
            const newEntries = new Map(entries);
            newEntries.delete(key);
            return newEntries;
          });
          yield* Ref.update(accessOrderRef, (o) => {
            const newAccessOrder = new Map(o);
            newAccessOrder.delete(key);
            return newAccessOrder;
          });
        });

      const invalidateBlock = (blockNumber: bigint): Effect.Effect<void> =>
        Effect.gen(function* () {
          if (!blockScoped) {
            return;
          }

          const entries = yield* Ref.get(entriesRef);
          const keysToInvalidate: string[] = [];

          for (const [key, entry] of entries.entries()) {
            if (entry.blockNumber !== undefined && entry.blockNumber < blockNumber) {
              keysToInvalidate.push(key);
            }
          }

          // Invalidate all matching keys
          yield* Effect.all(
            keysToInvalidate.map((key) => invalidate(key)),
            { concurrency: "unbounded" }
          );
        });

      const clear: Effect.Effect<void> = Effect.gen(function* () {
        yield* Ref.set(entriesRef, new Map());
        yield* Ref.set(accessOrderRef, new Map());
        yield* Ref.set(accessCounterRef, 0);
      });

      return {
        clear,
        get,
        invalidate,
        invalidateBlock,
        set,
      } satisfies RpcCacheShape;
    })
  );
};
