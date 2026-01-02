"use client";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as React from "react";
import { makeScopedRun } from "../internal/scoped-run.js";
import { useEffectEvmRuntime } from "../provider.js";

export type EffectMemoOptions<A> = {
  readonly key?: string | undefined;
  readonly minIntervalMs?: number | undefined;
  readonly debounceMs?: number | undefined;
  readonly transition?: boolean | undefined;
  readonly initial?: A | undefined;
};

export const useEffectMemoFactory = <A, E, R>(
  effectFactory: (signal: AbortSignal) => Effect.Effect<A, E, R>,
  deps: React.DependencyList,
  options: EffectMemoOptions<A> = {}
): A | undefined => {
  const runtime = useEffectEvmRuntime();
  const [value, setValue] = React.useState<A | undefined>(options.initial);
  const inFlightRef = React.useRef<{
    key: string | null;
    fiber: Fiber.RuntimeFiber<Exit.Exit<A, E>, never> | null;
    close: (() => void) | null;
    abort: AbortController | null;
  }>({ abort: null, close: null, fiber: null, key: null });
  const lastRunRef = React.useRef<{ key: string | null; at: number }>({ at: 0, key: null });
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    let active = true;

    const key = options.key ?? null;
    const minIntervalMs = options.minIntervalMs ?? 0;
    const debounceMs = options.debounceMs ?? 0;
    const useTransition = options.transition !== false;

    const now = Date.now();
    if (key && inFlightRef.current.key === key && inFlightRef.current.fiber) {
      return () => {
        active = false;
      };
    }
    if (
      key &&
      minIntervalMs > 0 &&
      lastRunRef.current.key === key &&
      now - lastRunRef.current.at < minIntervalMs
    ) {
      return () => {
        active = false;
      };
    }

    const run = () => {
      const controller = new AbortController();

      (async () => {
        const scoped = await makeScopedRun(runtime);
        const effect = effectFactory(controller.signal);

        const fiber = scoped.fork(
          Effect.exit(
            (effect as unknown as Effect.Effect<A, E, unknown>).pipe(
              Effect.tap((result) =>
                Effect.sync(() => {
                  if (!active) {
                    return;
                  }
                  if (useTransition) {
                    React.startTransition(() => setValue(result));
                  } else {
                    setValue(result);
                  }
                })
              ),
              Effect.tapErrorCause((cause) =>
                Effect.sync(() => {
                  if (!Cause.isEmpty(cause)) {
                    console.error("[useEffectMemoFactory] Fiber error:", Cause.pretty(cause));
                  }
                })
              )
            )
          )
        );

        inFlightRef.current = { abort: controller, close: scoped.close, fiber, key };
        lastRunRef.current = { at: Date.now(), key };

        await runtime.runPromise(Fiber.join(fiber));

        if (inFlightRef.current.fiber === fiber) {
          inFlightRef.current = { abort: null, close: null, fiber: null, key: null };
        }

        scoped.close();
      })().catch((cause) => {
        if (active && !controller.signal.aborted) {
          console.error("[useEffectMemoFactory] Fiber error:", cause);
        }
      });
    };

    if (debounceMs > 0) {
      timeoutRef.current = setTimeout(run, debounceMs);
    } else {
      run();
    }

    return () => {
      active = false;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (inFlightRef.current.abort) {
        inFlightRef.current.abort.abort();
      }

      if (inFlightRef.current.close) {
        inFlightRef.current.close();
      }

      if (inFlightRef.current.key === key) {
        inFlightRef.current = { abort: null, close: null, fiber: null, key: null };
      }
    };
  }, [runtime, ...deps]);

  return value;
};
