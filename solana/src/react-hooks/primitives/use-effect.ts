"use client";

import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as React from "react";
import type { EffectError } from "../internal/error.js";
import { fromCause, fromUnknown } from "../internal/error.js";
import { isDev } from "../internal/is-dev.js";
import { makeScopedRun } from "../internal/scoped-run.js";
import { useEffectSolanaRuntime } from "../provider.js";

export type UseEffectResult<A, E> =
  | {
      readonly status: "idle" | "loading";
      readonly data?: A | undefined;
      readonly error?: never;
    }
  | { readonly status: "success"; readonly data: A; readonly error?: never }
  | {
      readonly status: "error";
      readonly data?: never;
      readonly error: EffectError<E>;
    };

export const useEffectOnce = <A, E, R>(
  makeEffect: () => Effect.Effect<A, E, R>,
  options: { readonly initial?: A | undefined } = {}
): UseEffectResult<A, E> => {
  const runtime = useEffectSolanaRuntime();
  const devRef = React.useRef<{
    makeEffect: () => Effect.Effect<A, E, R>;
    initial: A | undefined;
    warned: boolean;
  } | null>(null);
  if (isDev) {
    if (devRef.current === null) {
      devRef.current = { initial: options.initial, makeEffect, warned: false };
    } else if (
      !devRef.current.warned &&
      (devRef.current.makeEffect !== makeEffect || devRef.current.initial !== options.initial)
    ) {
      devRef.current.warned = true;
      // biome-ignore lint/suspicious/noConsole: Dev-only warning for non-reactive input changes.
      console.warn(
        [
          "[effect-solana] useEffectOnce ignores changes after the first render.",
          "Memoize inputs or switch to useEffectMemo for reactive effects.",
        ].join(" ")
      );
    }
  }
  const [state, setState] = React.useState<UseEffectResult<A, E>>(() => ({
    data: options.initial,
    status: "idle",
  }));

  React.useEffect(() => {
    let cancelled = false;
    let scopedClose: (() => void) | null = null;

    setState({ data: options.initial, status: "loading" });

    (async () => {
      const scoped = await makeScopedRun(runtime);
      scopedClose = scoped.close;

      const fiber = scoped.fork(
        Effect.exit(makeEffect() as unknown as Effect.Effect<A, E, unknown>)
      );
      const exit = await runtime.runPromise(Fiber.join(fiber));

      if (cancelled) {
        return;
      }

      if (exit._tag === "Success") {
        setState({ data: exit.value, status: "success" });
        return;
      }

      setState({ error: fromCause(exit.cause), status: "error" });
    })().catch((cause) => {
      if (!cancelled) {
        setState({ error: fromUnknown(cause), status: "error" });
      }
    });

    return () => {
      cancelled = true;
      scopedClose?.();
    };
  }, [runtime]);

  return state;
};

/**
 * Runs an Effect when dependencies change, similar to React's `useEffect` + `useMemo`.
 *
 * @remarks
 * **Stability requirements:**
 *
 * 1. **`makeEffect` must be stable** — wrap with `useCallback` or define outside the component.
 *    Passing an inline arrow function will cause the effect to re-run on every render.
 *
 * 2. **`deps` must contain referentially stable values** — works like React's `useEffect`.
 *    Passing inline objects/arrays/functions will cause infinite re-renders.
 *
 * 3. **`options.initial` should be stable** — wrap with `useMemo` if computed, or move outside.
 *
 * @example
 * ```tsx
 * // ✅ CORRECT: makeEffect is stable (defined outside component)
 * const fetchUser = (id: string) => () =>
 *   Effect.gen(function* () {
 *     const user = yield* UserService.getUser(id);
 *     return user;
 *   });
 *
 * function UserProfile({ userId }: { userId: string }) {
 *   const result = useEffectMemo(fetchUser(userId), [userId]);
 *   // Effect re-runs only when userId changes
 * }
 * ```
 *
 * @example
 * ```tsx
 * // ✅ CORRECT: makeEffect is memoized with useCallback
 * function TokenBalance({ address }: { address: string }) {
 *   const getBalance = useCallback(
 *     () => TokenService.getBalance(address),
 *     [address]
 *   );
 *   const result = useEffectMemo(getBalance, [address]);
 * }
 * ```
 *
 * @example
 * ```tsx
 * // ❌ WRONG: inline makeEffect causes re-run on every render
 * function Example({ userId }: { userId: string }) {
 *   const result = useEffectMemo(
 *     () => UserService.getUser(userId), // inline function — BAD!
 *     [userId]
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // ❌ WRONG: inline object in deps causes infinite re-renders
 * function Example() {
 *   const result = useEffectMemo(
 *     fetchData,
 *     [{ filter: "active" }] // new object on every render — BAD!
 *   );
 * }
 * ```
 *
 * @param makeEffect - Factory function returning an Effect. Must be referentially stable.
 * @param deps - Dependency array (like React's useEffect). Values must be referentially stable.
 * @param options - Optional configuration. `initial` sets the initial data value.
 * @returns State object with `status`, `data`, and `error` fields.
 */
export const useEffectMemo = <A, E, R>(
  makeEffect: () => Effect.Effect<A, E, R>,
  deps: React.DependencyList,
  options: { readonly initial?: A | undefined } = {}
): UseEffectResult<A, E> => {
  const runtime = useEffectSolanaRuntime();
  const [state, setState] = React.useState<UseEffectResult<A, E>>(() => ({
    data: options.initial,
    status: "idle",
  }));

  React.useEffect(() => {
    let cancelled = false;
    let scopedClose: (() => void) | null = null;

    setState({ data: options.initial, status: "loading" });

    (async () => {
      const scoped = await makeScopedRun(runtime);
      scopedClose = scoped.close;

      const fiber = scoped.fork(
        Effect.exit(makeEffect() as unknown as Effect.Effect<A, E, unknown>)
      );
      const exit = await runtime.runPromise(Fiber.join(fiber));

      if (cancelled) {
        return;
      }

      if (exit._tag === "Success") {
        setState({ data: exit.value, status: "success" });
        return;
      }

      setState({ error: fromCause(exit.cause), status: "error" });
    })().catch((cause) => {
      if (!cancelled) {
        setState({ error: fromUnknown(cause), status: "error" });
      }
    });

    return () => {
      cancelled = true;
      scopedClose?.();
    };
  }, [runtime, ...deps]);

  return state;
};
