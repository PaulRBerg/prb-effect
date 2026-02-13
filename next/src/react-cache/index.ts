import "server-only";

/**
 * Request-Scoped Effect Cache
 *
 * Wraps Effect-returning functions with React's `cache` primitive to:
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

import type { Exit } from "effect";
import { Effect, Runtime } from "effect";
import type * as Scope from "effect/Scope";
import { cache } from "react";

type NoScope<R> = [Extract<R, Scope.Scope>] extends [never]
  ? R
  : [
      "⛔ reactCache: Effects requiring Scope cannot be cached.",
      "Move resource acquisition outside, or memoize with a Layer instead.",
    ];

const runEffectCachedFn = cache(
  <A, E, R, Args extends unknown[]>(
    effect: (...args: Args) => Effect.Effect<A, E, NoScope<R>>,
    ...args: Args
  ) => {
    let promise: Promise<Exit.Exit<A, E>>;
    return (runtime: Runtime.Runtime<NoScope<R>>) => {
      if (!promise) {
        promise = Runtime.runPromiseExit(runtime, effect(...args));
      }
      return promise;
    };
  }
);

export function reactCache<A, E, R, Args extends unknown[]>(
  effect: (...args: Args) => Effect.Effect<A, E, NoScope<R>>
) {
  return (...args: Args): Effect.Effect<A, E, NoScope<R>> =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<NoScope<R>>();
      const exit = yield* Effect.promise(() => runEffectCachedFn(effect, ...args)(runtime));
      return yield* exit;
    });
}
