import "server-only";
import { Effect } from "effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import { cache } from "react";

/**
 * Wraps an Effect with React's cache() for request-scoped deduplication.
 * The entire effect including layer provision must be inside this wrapper.
 *
 * React's cache() ensures that within a single request (server render), the same
 * Effect will only execute once even if called multiple times. This is useful for
 * preventing duplicate database queries or API calls during SSR.
 *
 * @param effect - Effect to cache
 * @param runtime - ManagedRuntime to execute the Effect
 * @returns Cached function that returns a Promise of the Effect's result
 *
 * @example
 * ```tsx
 * // lib/data.ts
 * import { reactCache } from "effect-next/cache";
 * import { Effect } from "effect";
 *
 * const runtime = ManagedRuntime.make(AppLayer);
 *
 * export const getUser = reactCache(
 *   Effect.gen(function* () {
 *     const db = yield* Database;
 *     return yield* db.query("SELECT * FROM users");
 *   }),
 *   runtime
 * );
 *
 * // Multiple components can call getUser() in the same request
 * // but the database query will only execute once
 * ```
 */
export function reactCache<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtime: ManagedRuntime.ManagedRuntime<R, never>
): () => Promise<A> {
  const traced = Effect.withSpan(effect, "reactCache");
  return cache(() => runtime.runPromise(traced));
}

/**
 * Creates a cached function that accepts parameters and returns a cached Effect result.
 * Each unique set of parameters will have its own cache entry within the request scope.
 *
 * @param effectFn - Function that takes parameters and returns an Effect
 * @param runtime - ManagedRuntime to execute the Effect
 * @returns Cached function that accepts parameters and returns a Promise
 *
 * @example
 * ```tsx
 * // lib/data.ts
 * import { reactCacheFn } from "effect-next/cache";
 * import { Effect } from "effect";
 *
 * const runtime = ManagedRuntime.make(AppLayer);
 *
 * export const getUserById = reactCacheFn(
 *   (userId: string) =>
 *     Effect.gen(function* () {
 *       const db = yield* Database;
 *       return yield* db.query("SELECT * FROM users WHERE id = ?", [userId]);
 *     }),
 *   runtime
 * );
 *
 * // Multiple calls with the same userId will only query once per request
 * const user1 = await getUserById("123");
 * const user2 = await getUserById("123"); // Cached, no DB query
 * const user3 = await getUserById("456"); // Different ID, new query
 * ```
 */
export function reactCacheFn<Args extends readonly unknown[], A, E, R>(
  effectFn: (...args: Args) => Effect.Effect<A, E, R>,
  runtime: ManagedRuntime.ManagedRuntime<R, never>
): (...args: Args) => Promise<A> {
  return cache((...args: Args) => {
    const traced = Effect.withSpan(effectFn(...args), "reactCacheFn");
    return runtime.runPromise(traced);
  });
}

/**
 * Creates a cached function with a custom cache key generator.
 * Useful when parameters are complex objects and you want fine-grained control
 * over cache key generation.
 *
 * **Important:** The `keyFn` must be deterministic - calls with different args that
 * produce the same key will return the cached result from whichever call executed first.
 * Ensure your key function captures all semantically relevant differences in the args.
 *
 * @param effectFn - Function that takes parameters and returns an Effect
 * @param keyFn - Function to generate a cache key from parameters
 * @param runtime - ManagedRuntime to execute the Effect
 * @returns Cached function that accepts parameters and returns a Promise
 *
 * @example
 * ```tsx
 * // lib/data.ts
 * import { reactCacheWithKey } from "effect-next/cache";
 * import { Effect } from "effect";
 *
 * const runtime = ManagedRuntime.make(AppLayer);
 *
 * type QueryOptions = {
 *   userId: string;
 *   includeDeleted?: boolean;
 * };
 *
 * export const getUser = reactCacheWithKey(
 *   (options: QueryOptions) =>
 *     Effect.gen(function* () {
 *       const db = yield* Database;
 *       const query = options.includeDeleted
 *         ? "SELECT * FROM users WHERE id = ?"
 *         : "SELECT * FROM users WHERE id = ? AND deleted_at IS NULL";
 *       return yield* db.query(query, [options.userId]);
 *     }),
 *   (options) => `user:${options.userId}:${options.includeDeleted ?? false}`,
 *   runtime
 * );
 * ```
 */
export function reactCacheWithKey<Args extends readonly unknown[], A, E, R>(
  effectFn: (...args: Args) => Effect.Effect<A, E, R>,
  keyFn: (...args: Args) => string,
  runtime: ManagedRuntime.ManagedRuntime<R, never>
): (...args: Args) => Promise<A> {
  // Store args by key so the cached function can access them.
  // This is request-scoped in practice because React's cache() is request-scoped,
  // so concurrent requests won't interfere with each other's cached results.
  const argsForKey = new Map<string, Args>();

  // Only pass the key to React's cache() - this ensures deduplication is based
  // solely on the custom key, not on object identity of the original args.
  const cachedFn = cache((key: string) => {
    // Args are guaranteed to exist because we set them immediately before calling cachedFn
    const args = argsForKey.get(key) as Args;
    const traced = Effect.withSpan(effectFn(...args), "reactCacheWithKey");
    return runtime.runPromise(traced);
  });

  return (...args: Args) => {
    const key = keyFn(...args);
    argsForKey.set(key, args);
    return cachedFn(key);
  };
}
