"use client";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import { constVoid as noop } from "effect/Function";
import * as Scope from "effect/Scope";
import type { EffectSolanaRuntime } from "./runtime.js";

export type ScopedRun = {
  readonly close: () => void;
  readonly fork: <A, E, R>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>;
  readonly scope: Scope.Closeable;
};

export async function makeScopedRun(runtime: EffectSolanaRuntime): Promise<ScopedRun> {
  const scope = await runtime.runPromise(Scope.fork(runtime.scope, "sequential"));
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    void runtime.runPromise(Scope.close(scope, Exit.void)).catch(noop);
  }

  function fork<A, E, R>(effect: Effect.Effect<A, E, R>) {
    // Deferred forkIn attaches the fiber before starting it, including when the
    // parent closed between scope creation and this asynchronous continuation.
    return Effect.runSyncWith(runtime.context)(Effect.forkIn(Scope.provide(effect, scope), scope));
  }

  return { close, fork, scope };
}
