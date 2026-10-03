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

  const [runtime, setRuntime] = React.useState<EffectEvmRuntime | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let current: EffectEvmRuntime | null = null;

    setRuntime(null);

    (async () => {
      const built = await buildRuntime(layer);
      current = built;

      if (cancelled) {
        await closeRuntime(built.scope);
        return;
      }

      setRuntime(built);
    })().catch((cause) => {
      onUnhandledError?.(cause);
    });

    return () => {
      cancelled = true;
      if (current) {
        closeRuntime(current.scope).catch(noop);
      }
    };
  }, [layer, onUnhandledError]);

  if (runtime === null) {
    return React.createElement(React.Fragment, null, fallback);
  }

  return React.createElement(EffectEvmRuntimeContext.Provider, { value: runtime }, children);
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
