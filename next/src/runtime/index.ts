import "server-only";
import type { Layer, Runtime } from "effect";
import { Effect, ManagedRuntime } from "effect";

/**
 * Global store for runtime instances (survives HMR).
 */
const globalValue = <T>(key: string, create: () => T): T => {
  const globalStore = globalThis as unknown as Record<string, T>;
  if (!(key in globalStore)) {
    globalStore[key] = create();
  }
  return globalStore[key];
};

type StatefulRuntimeOptions = {
  readonly id?: string;
  readonly enableShutdownHooks?: boolean;
};

/**
 * Creates a ManagedRuntime that survives HMR in development.
 * Registers SIGINT/SIGTERM handlers for graceful shutdown.
 */
export function createStatefulRuntime<R, E>(
  layer: Layer.Layer<R, E, never>,
  options?: StatefulRuntimeOptions
): ManagedRuntime.ManagedRuntime<R, E> {
  const id = options?.id ?? "default";
  const key = `effect-next/runtime/${id}`;

  return globalValue(key, () => {
    const runtime = ManagedRuntime.make(layer);

    if (options?.enableShutdownHooks !== false) {
      const shutdown = () => {
        Effect.runPromise(runtime.disposeEffect).catch(console.error);
      };

      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }

    return runtime;
  });
}

/**
 * Extract context from a stateful runtime as an Effect.
 */
export function createStatefulContext<R, E>(
  runtime: ManagedRuntime.ManagedRuntime<R, E>
): Effect.Effect<Runtime.Runtime<R>, E, never> {
  return runtime.runtimeEffect;
}
