"use client";

import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as React from "react";
import type { EffectError } from "../internal/error.js";
import { fromCause, fromUnknown } from "../internal/error.js";
import { isDev } from "../internal/is-dev.js";
import { makeScopedRun } from "../internal/scoped-run.js";
import { useEffectWeb3Runtime } from "../provider.js";

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
  const runtime = useEffectWeb3Runtime();
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
      console.warn(
        [
          "[effect-web3] useEffectOnce ignores changes after the first render.",
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

export const useEffectMemo = <A, E, R>(
  makeEffect: () => Effect.Effect<A, E, R>,
  deps: React.DependencyList,
  options: { readonly initial?: A | undefined } = {}
): UseEffectResult<A, E> => {
  const runtime = useEffectWeb3Runtime();
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
