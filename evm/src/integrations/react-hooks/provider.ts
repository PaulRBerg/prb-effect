"use client";

import { constVoid as noop } from "effect/Function";
import type * as Layer from "effect/Layer";
import * as React from "react";
import type { EffectEvmRuntime } from "./internal/runtime.js";
import { buildRuntime, buildRuntimeSync, closeRuntime } from "./internal/runtime.js";

export type EffectEvmProviderProps = {
  readonly children?: React.ReactNode;
  readonly fallback?: React.ReactNode;
  readonly layer: Layer.Layer<never, unknown, never>;
  readonly onUnhandledError?: (cause: unknown) => void;
};

export type EffectEvmLayerProviderProps = {
  readonly children?: React.ReactNode;
  readonly layer: Layer.Layer<never, unknown, never>;
};

const EffectEvmRuntimeContext = React.createContext<EffectEvmRuntime | null>(null);
const EffectEvmLayerContext = React.createContext<Layer.Layer<never, unknown, never> | null>(null);

export const EffectEvmProvider = (props: EffectEvmProviderProps): React.ReactElement => {
  const { children, fallback = null, layer, onUnhandledError } = props;
  const [built, setBuilt] = React.useState<{
    readonly layer: typeof layer;
    readonly onUnhandledError: typeof onUnhandledError;
    readonly runtime: EffectEvmRuntime;
  } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let current: EffectEvmRuntime | null = null;

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

  return React.createElement(EffectEvmRuntimeContext.Provider, { value: built.runtime }, children);
};

/** Builds synchronous layers after commit; renders fallback until the runtime is ready. */
export const EffectEvmProviderSync = (props: EffectEvmProviderProps): React.ReactElement => {
  const { children, fallback = null, layer, onUnhandledError } = props;
  const [built, setBuilt] = React.useState<{
    readonly layer: typeof layer;
    readonly onUnhandledError: typeof onUnhandledError;
    readonly runtime: EffectEvmRuntime;
  } | null>(null);

  React.useEffect(() => {
    let runtime: EffectEvmRuntime;
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

  return React.createElement(EffectEvmRuntimeContext.Provider, { value: built.runtime }, children);
};

export const EffectEvmLayerProvider = (props: EffectEvmLayerProviderProps): React.ReactElement => {
  const { children, layer } = props;
  return React.createElement(EffectEvmLayerContext.Provider, { value: layer }, children);
};

export const useEffectEvmRuntime = (): EffectEvmRuntime => {
  const runtime = React.useContext(EffectEvmRuntimeContext);
  if (runtime === null) {
    throw new Error("EffectEvmProvider is missing (useEffectEvmRuntime)");
  }
  return runtime;
};

export const useEffectEvmLayer = (): Layer.Layer<never, unknown, never> => {
  const layer = React.useContext(EffectEvmLayerContext);
  if (layer === null) {
    throw new Error("EffectEvmLayerProvider is missing (useEffectEvmLayer)");
  }
  return layer;
};
