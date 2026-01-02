import type * as Effect from "effect/Effect";
import * as Effect_ from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import type * as Layer from "effect/Layer";
import * as Layer_ from "effect/Layer";
import type * as Runtime from "effect/Runtime";
import * as Runtime_ from "effect/Runtime";
import type * as Scope from "effect/Scope";
import * as Scope_ from "effect/Scope";

export type EffectEvmRuntime = {
  readonly runFork: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: Runtime.RunForkOptions | undefined
  ) => Fiber.RuntimeFiber<A, E>;
  readonly runPromise: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal } | undefined
  ) => Promise<A>;
  readonly runPromiseExit: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal } | undefined
  ) => Promise<Exit.Exit<A, E>>;
  readonly runtime: Runtime.Runtime<unknown>;
  readonly scope: Scope.Scope.Closeable;
};

export const buildRuntime = async (
  layer: Layer.Layer<never, unknown, never>
): Promise<EffectEvmRuntime> => {
  const scope = await Effect_.runPromise(Scope_.make());
  const runtime = await Effect_.runPromise(
    Scope_.extend(scope)(Layer_.toRuntime(layer as Layer.Layer<unknown, unknown, never>))
  );

  const runFork = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: Runtime.RunForkOptions | undefined
  ) => Runtime_.runFork(runtime, effect as unknown as Effect.Effect<A, E, unknown>, options);

  const runPromise = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal } | undefined
  ) => Runtime_.runPromise(runtime, effect as unknown as Effect.Effect<A, E, unknown>, options);

  const runPromiseExit = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal } | undefined
  ) => Runtime_.runPromiseExit(runtime, effect as unknown as Effect.Effect<A, E, unknown>, options);

  return {
    runFork,
    runPromise,
    runPromiseExit,
    runtime: runtime as unknown as Runtime.Runtime<unknown>,
    scope,
  };
};

export const buildRuntimeSync = (layer: Layer.Layer<never, unknown, never>): EffectEvmRuntime => {
  const scope = Effect_.runSync(Scope_.make());
  const runtime = Effect_.runSync(
    Scope_.extend(scope)(Layer_.toRuntime(layer as Layer.Layer<unknown, unknown, never>))
  );

  const runFork = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: Runtime.RunForkOptions | undefined
  ) => Runtime_.runFork(runtime, effect as unknown as Effect.Effect<A, E, unknown>, options);

  const runPromise = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal } | undefined
  ) => Runtime_.runPromise(runtime, effect as unknown as Effect.Effect<A, E, unknown>, options);

  const runPromiseExit = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal } | undefined
  ) => Runtime_.runPromiseExit(runtime, effect as unknown as Effect.Effect<A, E, unknown>, options);

  return {
    runFork,
    runPromise,
    runPromiseExit,
    runtime: runtime as unknown as Runtime.Runtime<unknown>,
    scope,
  };
};

export const closeRuntime = async (scope: Scope.Scope.Closeable): Promise<void> => {
  await Effect_.runPromise(Scope_.close(scope, Exit.succeed(undefined)));
};
