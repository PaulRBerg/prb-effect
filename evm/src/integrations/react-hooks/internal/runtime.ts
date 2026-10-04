import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { constVoid as noop } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

export type EffectEvmRuntime = {
  readonly runFork: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: Effect.RunOptions | undefined
  ) => Fiber.Fiber<A, E>;
  readonly runPromise: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: Effect.RunOptions | undefined
  ) => Promise<A>;
  readonly runPromiseExit: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: Effect.RunOptions | undefined
  ) => Promise<Exit.Exit<A, E>>;
  readonly context: Context.Context<unknown>;
  readonly scope: Scope.Closeable;
};

function makeRuntime(context: Context.Context<unknown>, scope: Scope.Closeable): EffectEvmRuntime {
  return {
    context,
    runFork: Effect.runForkWith(context),
    runPromise: Effect.runPromiseWith(context),
    runPromiseExit: Effect.runPromiseExitWith(context),
    scope,
  };
}

function buildContext(layer: Layer.Layer<never, unknown, never>, scope: Scope.Closeable) {
  return Effect.gen(function* () {
    const services = yield* Layer.build(layer as Layer.Layer<unknown, unknown, never>);
    const current = yield* Effect.context();
    return Context.merge(current, services);
  }).pipe(Scope.provide(scope));
}

export async function buildRuntime(
  layer: Layer.Layer<never, unknown, never>
): Promise<EffectEvmRuntime> {
  const scope = Scope.makeUnsafe();
  return makeRuntime(await Effect.runPromise(buildContext(layer, scope)), scope);
}

export function buildRuntimeSync(layer: Layer.Layer<never, unknown, never>): EffectEvmRuntime {
  const scope = Scope.makeUnsafe();
  try {
    const context = Effect.runSync(
      buildContext(layer, scope).pipe(
        Effect.forkIn(scope, { startImmediately: true }),
        Effect.flatMap(Fiber.join)
      )
    );
    return makeRuntime(context, scope);
  } catch (cause) {
    void Effect.runPromise(Scope.close(scope, Exit.fail(cause))).catch(noop);
    throw cause;
  }
}

export async function closeRuntime(scope: Scope.Closeable): Promise<void> {
  await Effect.runPromise(Scope.close(scope, Exit.void));
}
