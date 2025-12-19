"use client";

import { Cause, Chunk, Effect, Exit, Fiber, Stream, SubscriptionRef } from "effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import type { DependencyList } from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Runs an Effect and memoizes the result based on dependencies.
 *
 * @param effectFn - Function that returns the Effect to run. Called on each dependency change.
 * @param deps - React dependency array. The effect re-runs when these change.
 *               Note: effectFn and runtime are intentionally not included in deps
 *               to allow for stable function references. If your effectFn captures
 *               values that change, include those values in deps.
 * @param runtime - ManagedRuntime to execute the Effect
 * @returns The result of the Effect, or undefined if not yet completed
 * @throws Re-throws Effect errors for React error boundaries
 *
 * @example
 * ```tsx
 * function UserProfile({ userId }: { userId: string }) {
 *   const runtime = useEffectNextRuntime();
 *   const user = useEffectMemo(
 *     () => fetchUser(userId),
 *     [userId],
 *     runtime
 *   );
 *
 *   if (!user) return <div>Loading...</div>;
 *   return <div>{user.name}</div>;
 * }
 * ```
 */
export function useEffectMemo<A, E, R>(
  effectFn: () => Effect.Effect<A, E, R>,
  deps: DependencyList,
  runtime: ManagedRuntime.ManagedRuntime<R, never>
): A | undefined {
  const [state, setState] = useState<{ value: A } | { error: E } | undefined>();
  const fiberRef = useRef<Fiber.RuntimeFiber<A, E> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    // Interrupt any previous fiber
    if (fiberRef.current) {
      runtime.runFork(Fiber.interrupt(fiberRef.current));
    }

    const effect = effectFn();
    const fiber = runtime.runFork(effect);
    fiberRef.current = fiber;

    runtime.runPromise(Fiber.await(fiber)).then((exit) => {
      // Don't update state if unmounted
      if (!isMountedRef.current) {
        return;
      }

      if (Exit.isSuccess(exit)) {
        setState({ value: exit.value });
      } else {
        const errors = Cause.failures(exit.cause);
        if (!Chunk.isEmpty(errors)) {
          setState({ error: Chunk.unsafeHead(errors) });
        }
      }
    });

    return () => {
      isMountedRef.current = false;
      if (fiberRef.current) {
        runtime.runFork(Fiber.interrupt(fiberRef.current));
        fiberRef.current = null;
      }
    };
  }, deps);

  if (state) {
    if ("error" in state) {
      throw state.error;
    }
    return state.value;
  }

  return undefined;
}

/**
 * Runs an Effect exactly once on component mount.
 *
 * Note: In React 18+ StrictMode, effects run twice in development.
 * This hook uses a ref to ensure the effect only executes once,
 * which means the cleanup function won't be called on the "fake" unmount.
 *
 * @param effect - The Effect to run
 * @param runtime - ManagedRuntime to execute the Effect
 * @returns The result of the Effect, or undefined if not yet completed
 * @throws Re-throws Effect errors for React error boundaries
 *
 * @example
 * ```tsx
 * function Analytics() {
 *   const runtime = useEffectNextRuntime();
 *   const sessionId = useEffectOnce(
 *     Effect.gen(function* () {
 *       const id = yield* generateSessionId();
 *       yield* trackSession(id);
 *       return id;
 *     }),
 *     runtime
 *   );
 *
 *   return <div>Session: {sessionId ?? "Initializing..."}</div>;
 * }
 * ```
 */
export function useEffectOnce<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtime: ManagedRuntime.ManagedRuntime<R, never>
): A | undefined {
  const [state, setState] = useState<{ value: A } | { error: E } | undefined>();
  const fiberRef = useRef<Fiber.RuntimeFiber<A, E> | null>(null);
  const hasRun = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    if (hasRun.current) {
      return;
    }
    hasRun.current = true;
    isMountedRef.current = true;

    const fiber = runtime.runFork(effect);
    fiberRef.current = fiber;

    runtime.runPromise(Fiber.await(fiber)).then((exit) => {
      // Don't update state if unmounted
      if (!isMountedRef.current) {
        return;
      }

      if (Exit.isSuccess(exit)) {
        setState({ value: exit.value });
      } else {
        const errors = Cause.failures(exit.cause);
        if (!Chunk.isEmpty(errors)) {
          setState({ error: Chunk.unsafeHead(errors) });
        }
      }
    });

    return () => {
      isMountedRef.current = false;
      if (fiberRef.current) {
        runtime.runFork(Fiber.interrupt(fiberRef.current));
        fiberRef.current = null;
      }
    };
  }, [effect, runtime]);

  if (state) {
    if ("error" in state) {
      throw state.error;
    }
    return state.value;
  }

  return undefined;
}

/**
 * Subscribes to a SubscriptionRef and returns the current value.
 * Automatically updates when the ref changes.
 *
 * @param ref - SubscriptionRef to subscribe to
 * @param runtime - ManagedRuntime to execute the subscription
 * @returns Current value of the SubscriptionRef
 *
 * @example
 * ```tsx
 * // Create a SubscriptionRef somewhere in your app
 * const themeRef = SubscriptionRef.make("light");
 *
 * function ThemeToggle() {
 *   const runtime = useEffectNextRuntime();
 *   const theme = useSubscriptionRef(themeRef, runtime);
 *
 *   return (
 *     <button onClick={() => runtime.runPromise(
 *       SubscriptionRef.set(themeRef, theme === "light" ? "dark" : "light")
 *     )}>
 *       Current: {theme}
 *     </button>
 *   );
 * }
 * ```
 */
export function useSubscriptionRef<A>(
  ref: SubscriptionRef.SubscriptionRef<A>,
  runtime: ManagedRuntime.ManagedRuntime<never, never>
): A {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const fiber = runtime.runFork(
        ref.changes.pipe(Stream.runForEach(() => Effect.sync(onStoreChange)))
      );
      return () => {
        runtime.runFork(Fiber.interrupt(fiber));
      };
    },
    [ref, runtime]
  );

  const getSnapshot = useCallback(() => runtime.runSync(SubscriptionRef.get(ref)), [ref, runtime]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribes to a Stream and accumulates values into an array.
 *
 * @param stream - Stream to subscribe to
 * @param runtime - ManagedRuntime to execute the stream
 * @param options - Optional configuration
 * @param options.maxItems - Maximum number of items to keep (FIFO eviction)
 * @returns Array of all values emitted by the stream
 *
 * @example
 * ```tsx
 * function EventLog() {
 *   const runtime = useEffectNextRuntime();
 *   const events = useStream(
 *     Stream.fromAsyncIterable(
 *       eventSource.subscribe(),
 *       (error) => new Error(String(error))
 *     ),
 *     runtime,
 *     { maxItems: 100 } // Keep only last 100 items
 *   );
 *
 *   return (
 *     <ul>
 *       {events.map((event, i) => (
 *         <li key={i}>{event.message}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useStream<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  options?: { maxItems?: number }
): readonly A[] {
  const [values, setValues] = useState<A[]>([]);
  const [error, setError] = useState<E | undefined>(undefined);

  useEffect(() => {
    const fiber = runtime.runFork(
      stream.pipe(
        Stream.runForEach((v) =>
          Effect.sync(() => {
            setValues((prev) => {
              const next = [...prev, v];
              // Apply FIFO eviction if maxItems is specified
              if (options?.maxItems !== undefined && next.length > options.maxItems) {
                return next.slice(-options.maxItems);
              }
              return next;
            });
            setError(undefined);
          })
        ),
        Effect.catchAll((err) =>
          Effect.sync(() => {
            setError(err);
            console.error("[useStream] Stream failed:", err);
          })
        )
      )
    );

    return () => {
      Effect.runPromise(Fiber.interrupt(fiber)).catch(() => {
        // Fiber interruption expected on cleanup
      });
    };
  }, [stream, runtime, options?.maxItems]);

  if (error) {
    throw error;
  }

  return values;
}

/**
 * Subscribes to a Stream and returns only the latest value.
 *
 * @param stream - Stream to subscribe to
 * @param runtime - ManagedRuntime to execute the stream
 * @param initialValue - Initial value before the stream emits
 * @returns Latest value emitted by the stream
 *
 * @example
 * ```tsx
 * function LivePrice({ symbol }: { symbol: string }) {
 *   const runtime = useEffectNextRuntime();
 *   const price = useStreamLatest(
 *     getPriceStream(symbol),
 *     runtime,
 *     0
 *   );
 *
 *   return <div>${price.toFixed(2)}</div>;
 * }
 * ```
 */
export function useStreamLatest<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  initialValue: A
): A {
  const [value, setValue] = useState<A>(initialValue);
  const [error, setError] = useState<E | undefined>(undefined);

  useEffect(() => {
    const fiber = runtime.runFork(
      stream.pipe(
        Stream.runForEach((v) =>
          Effect.sync(() => {
            setValue(v);
            setError(undefined);
          })
        ),
        Effect.catchAll((err) =>
          Effect.sync(() => {
            setError(err);
            console.error("[useStreamLatest] Stream failed:", err);
          })
        )
      )
    );

    return () => {
      Effect.runPromise(Fiber.interrupt(fiber)).catch(() => {
        // Fiber interruption expected on cleanup
      });
    };
  }, [stream, runtime]);

  if (error) {
    throw error;
  }

  return value;
}

/**
 * Runs an Effect in the background (forked) when dependencies change.
 * Does not return a value; use for side effects only.
 *
 * @param effect - Effect to run in the background
 * @param runtime - ManagedRuntime to execute the Effect
 * @param deps - React dependency array. The effect re-runs when these change.
 *               Note: effect and runtime are intentionally not included in deps
 *               to allow for stable references. If your effect captures values
 *               that change, include those values in deps.
 *
 * @example
 * ```tsx
 * function Tracker({ userId }: { userId: string }) {
 *   const runtime = useEffectNextRuntime();
 *
 *   // Track page view whenever userId changes
 *   useForkEffect(
 *     Effect.gen(function* () {
 *       yield* analytics.trackPageView({ userId });
 *     }),
 *     runtime,
 *     [userId]
 *   );
 *
 *   return <div>Tracking user {userId}</div>;
 * }
 * ```
 */
export function useForkEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  deps: DependencyList = []
): void {
  useEffect(() => {
    const fiber = runtime.runFork(effect);

    return () => {
      Effect.runPromise(Fiber.interrupt(fiber)).catch(() => {
        // Fiber interruption expected on cleanup
      });
    };
  }, deps);
}
