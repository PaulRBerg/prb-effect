"use client";

import type * as Effect from "effect/Effect";
import * as ExecutionStrategy from "effect/ExecutionStrategy";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import { constVoid as noop } from "effect/Function";
import * as Scope_ from "effect/Scope";
import type { EffectSolanaRuntime } from "./runtime.js";

export type ScopedRun = {
  readonly close: () => void;
  readonly fork: <A, E, R>(effect: Effect.Effect<A, E, R>) => Fiber.RuntimeFiber<A, E>;
  readonly scope: Scope_.Scope.Closeable;
};

export const makeScopedRun = async (runtime: EffectSolanaRuntime): Promise<ScopedRun> => {
  const scope = await runtime.runPromise(Scope_.fork(runtime.scope, ExecutionStrategy.sequential));
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    runtime.runPromise(Scope_.close(scope, Exit.succeed(undefined))).catch(noop);
  };

  const fork = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    runtime.runFork(Scope_.extend(scope)(effect as unknown as Effect.Effect<A, E, unknown>), {
      scope,
    });

  return { close, fork, scope };
};
