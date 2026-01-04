import "server-only";

/**
 * Request-Scoped Effect Cache
 *
 * Re-exports `reactCache` from @mcrovero/effect-react-cache for use in
 * Server Components and server actions. This utility wraps Effect-returning
 * functions with React's `cache` primitive to:
 *
 * 1. **Deduplicate concurrent calls** within a request
 * 2. **Memoize by argument tuple** (same args → same result)
 * 3. **Preserve Effect ergonomics** (typed errors and environments)
 *
 * @example
 * ```ts
 * import { reactCache } from "effect-next/react-cache";
 *
 * const getUser = reactCache((id: string) =>
 *   Effect.gen(function* () {
 *     const service = yield* UserService;
 *     return yield* service.getUser(id);
 *   }).pipe(Effect.provide(UserLive))
 * );
 * ```
 *
 * @see https://react.dev/reference/react/cache
 */
export * from "@mcrovero/effect-react-cache/ReactCache";
