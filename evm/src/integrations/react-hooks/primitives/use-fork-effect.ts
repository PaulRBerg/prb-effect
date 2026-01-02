"use client";

import type * as Effect from "effect/Effect";
import { constVoid as noop } from "effect/Function";
import * as React from "react";
import { makeScopedRun } from "../internal/scoped-run.js";
import { useEffectEvmRuntime } from "../provider.js";

export const useForkEffect = <R>(
  makeEffect: () => Effect.Effect<void, never, R>,
  deps: React.DependencyList
): void => {
  const runtime = useEffectEvmRuntime();

  React.useEffect(() => {
    let scopedClose: (() => void) | null = null;

    (async () => {
      const scoped = await makeScopedRun(runtime);
      scopedClose = scoped.close;

      scoped.fork(makeEffect() as unknown as Effect.Effect<void, never, unknown>);
    })().catch(noop);

    return () => {
      scopedClose?.();
    };
  }, [runtime, ...deps]);
};
