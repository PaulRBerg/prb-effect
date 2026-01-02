"use client";

import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as React from "react";
import { fromCause, fromUnknown } from "../internal/error.js";
import { isDev } from "../internal/is-dev.js";
import { makeScopedRun } from "../internal/scoped-run.js";
import { useEffectEvmRuntime } from "../provider.js";

export type StreamState<A> =
  | { readonly status: "starting"; readonly value?: A | undefined }
  | { readonly status: "running"; readonly value: A }
  | {
      readonly status: "error";
      readonly error: unknown;
      readonly value?: A | undefined;
    };

type ExternalStore<S> = {
  readonly getSnapshot: () => S;
  readonly setSnapshot: (value: S) => void;
  readonly subscribe: (listener: () => void) => () => void;
};

const makeExternalStore = <S>(initial: S): ExternalStore<S> => {
  let snapshot = initial;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (value) => {
      snapshot = value;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const useStream = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  options: { readonly initial?: A | undefined } = {}
): StreamState<A> => {
  const runtime = useEffectEvmRuntime();
  const devRef = React.useRef<{ initial: A | undefined; warned: boolean } | null>(null);
  if (isDev) {
    if (devRef.current === null) {
      devRef.current = { initial: options.initial, warned: false };
    } else if (!devRef.current.warned && devRef.current.initial !== options.initial) {
      devRef.current.warned = true;
      console.warn(
        [
          "[effect-evm] useStream does not react to initial changes after mount.",
          "If you need to update the initial value, recreate the stream or use stable inputs.",
        ].join(" ")
      );
    }
  }
  const storeRef = React.useRef<ExternalStore<StreamState<A>> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = makeExternalStore<StreamState<A>>({
      status: "starting",
      value: options.initial,
    });
  }

  const store = storeRef.current;
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  React.useEffect(() => {
    store.setSnapshot({ status: "starting", value: options.initial });

    let cancelled = false;
    let scopedClose: (() => void) | null = null;
    let lastValue = options.initial;

    (async () => {
      const scoped = await makeScopedRun(runtime);
      scopedClose = scoped.close;

      const runner = Stream.runForEach(stream, (value) =>
        Effect.sync(() => {
          lastValue = value;
          store.setSnapshot({ status: "running", value });
        })
      );

      const fiber = scoped.fork(Effect.exit(runner));
      const exit = await runtime.runPromise(Fiber.join(fiber));

      if (cancelled) {
        return;
      }

      if (exit._tag === "Failure") {
        store.setSnapshot({
          error: fromCause(exit.cause),
          status: "error",
          value: lastValue,
        });
      }
    })().catch((cause) => {
      if (!cancelled) {
        store.setSnapshot({
          error: fromUnknown(cause),
          status: "error",
          value: lastValue,
        });
      }
    });

    return () => {
      cancelled = true;
      scopedClose?.();
    };
  }, [runtime, store, stream]);

  return state;
};

export const useStreamEffect = <A, E, R>(
  makeStream: () => Effect.Effect<Stream.Stream<A, E, R>, E, R>,
  deps: React.DependencyList,
  options: { readonly initial?: A | undefined } = {}
): StreamState<A> => {
  const runtime = useEffectEvmRuntime();
  const storeRef = React.useRef<ExternalStore<StreamState<A>> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = makeExternalStore<StreamState<A>>({
      status: "starting",
      value: options.initial,
    });
  }

  const store = storeRef.current;
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  React.useEffect(() => {
    store.setSnapshot({ status: "starting", value: options.initial });

    let cancelled = false;
    let scopedClose: (() => void) | null = null;
    let lastValue = options.initial;

    (async () => {
      const scoped = await makeScopedRun(runtime);
      scopedClose = scoped.close;

      const stream = await runtime.runPromise(
        Scope.extend(scoped.scope)(
          makeStream() as unknown as Effect.Effect<Stream.Stream<A, E, unknown>, E, unknown>
        )
      );

      const runner = Stream.runForEach(stream, (value) =>
        Effect.sync(() => {
          lastValue = value;
          store.setSnapshot({ status: "running", value });
        })
      );

      const fiber = scoped.fork(Effect.exit(runner));
      const exit = await runtime.runPromise(Fiber.join(fiber));

      if (cancelled) {
        return;
      }

      if (exit._tag === "Failure") {
        store.setSnapshot({
          error: fromCause(exit.cause),
          status: "error",
          value: lastValue,
        });
      }
    })().catch((cause) => {
      if (!cancelled) {
        store.setSnapshot({
          error: fromUnknown(cause),
          status: "error",
          value: lastValue,
        });
      }
    });

    return () => {
      cancelled = true;
      scopedClose?.();
    };
  }, [runtime, ...deps]);

  return state;
};

export const useStreamValue = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  options: { readonly initial?: A | undefined } = {}
): A | undefined => {
  const state = useStream(stream, options);
  if (state.status === "starting") {
    return options.initial;
  }
  if (state.status === "error") {
    return state.value ?? options.initial;
  }
  return state.value;
};

export const useSubscriptionRef = <A>(
  ref: import("effect/SubscriptionRef").SubscriptionRef<A>,
  initial: A
): A => {
  const state = useStream(ref.changes, { initial });
  return state.status === "starting" ? initial : (state.value ?? initial);
};

export const useSubscriptionRefValue = <A>(
  ref: import("effect/SubscriptionRef").SubscriptionRef<A>,
  initial: A
): A => useSubscriptionRef(ref, initial);
