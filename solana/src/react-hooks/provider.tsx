"use client";

import { constVoid as noop } from "effect/Function";
import type * as Layer from "effect/Layer";
import * as React from "react";
import type { EffectSolanaRuntime } from "./internal/runtime.js";
import { buildRuntime, buildRuntimeSync, closeRuntime } from "./internal/runtime.js";

export type EffectSolanaProviderProps = {
  readonly children?: React.ReactNode;
  readonly fallback?: React.ReactNode;
  readonly layer: Layer.Layer<never, unknown, never>;
  readonly onUnhandledError?: (cause: unknown) => void;
};

export type EffectSolanaLayerProviderProps = {
  readonly children?: React.ReactNode;
  readonly layer: Layer.Layer<never, unknown, never>;
};

const EffectSolanaRuntimeContext = React.createContext<EffectSolanaRuntime | null>(null);
const EffectSolanaLayerContext = React.createContext<Layer.Layer<never, unknown, never> | null>(
  null
);

export const EffectSolanaProvider = (props: EffectSolanaProviderProps): React.ReactElement => {
  const { children, fallback = null, layer, onUnhandledError } = props;

  const [built, setBuilt] = React.useState<{
    readonly layer: typeof layer;
    readonly onUnhandledError: typeof onUnhandledError;
    readonly runtime: EffectSolanaRuntime;
  } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let current: EffectSolanaRuntime | null = null;

    setBuilt(null);

    (async () => {
      const runtime = await buildRuntime(layer, { signal: controller.signal });
      current = runtime;

      if (controller.signal.aborted) {
        await closeRuntime(runtime.scope);
        return;
      }

      setBuilt({ layer, onUnhandledError, runtime });
    })().catch((cause) => {
      if (!controller.signal.aborted) onUnhandledError?.(cause);
    });

    return () => {
      controller.abort();
      if (current) {
        void closeRuntime(current.scope).catch(noop);
      }
    };
  }, [layer, onUnhandledError]);

  if (built === null || built.layer !== layer || built.onUnhandledError !== onUnhandledError) {
    return React.createElement(React.Fragment, null, fallback);
  }

  return React.createElement(
    EffectSolanaRuntimeContext.Provider,
    { value: built.runtime },
    children
  );
};

/** Builds synchronous layers after commit; renders fallback until the runtime is ready. */
export const EffectSolanaProviderSync = (props: EffectSolanaProviderProps): React.ReactElement => {
  const { children, fallback = null, layer, onUnhandledError } = props;
  const [built, setBuilt] = React.useState<{
    readonly layer: typeof layer;
    readonly onUnhandledError: typeof onUnhandledError;
    readonly runtime: EffectSolanaRuntime;
  } | null>(null);

  React.useEffect(() => {
    let runtime: EffectSolanaRuntime;
    try {
      runtime = buildRuntimeSync(layer);
    } catch (cause) {
      onUnhandledError?.(cause);
      throw cause;
    }

    setBuilt({ layer, onUnhandledError, runtime });
    return () => {
      void closeRuntime(runtime.scope).catch(noop);
    };
  }, [layer, onUnhandledError]);

  if (built === null || built.layer !== layer || built.onUnhandledError !== onUnhandledError) {
    return React.createElement(React.Fragment, null, fallback);
  }

  return React.createElement(
    EffectSolanaRuntimeContext.Provider,
    { value: built.runtime },
    children
  );
};

export const EffectSolanaLayerProvider = (
  props: EffectSolanaLayerProviderProps
): React.ReactElement => {
  const { children, layer } = props;
  return React.createElement(EffectSolanaLayerContext.Provider, { value: layer }, children);
};

export const useEffectSolanaRuntime = (): EffectSolanaRuntime => {
  const runtime = React.useContext(EffectSolanaRuntimeContext);
  if (runtime === null) {
    throw new Error("EffectSolanaProvider is missing (useEffectSolanaRuntime)");
  }
  return runtime;
};

export const useEffectSolanaLayer = (): Layer.Layer<never, unknown, never> => {
  const layer = React.useContext(EffectSolanaLayerContext);
  if (layer === null) {
    throw new Error("EffectSolanaLayerProvider is missing (useEffectSolanaLayer)");
  }
  return layer;
};
