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

  const [runtime, setRuntime] = React.useState<EffectSolanaRuntime | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let current: EffectSolanaRuntime | null = null;

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

  return React.createElement(EffectSolanaRuntimeContext.Provider, { value: runtime }, children);
};

export const EffectSolanaProviderSync = (props: EffectSolanaProviderProps): React.ReactElement => {
  const { children, layer, onUnhandledError } = props;

  const runtime = React.useMemo(() => {
    try {
      return buildRuntimeSync(layer);
    } catch (cause) {
      onUnhandledError?.(cause);
      throw cause;
    }
  }, [layer, onUnhandledError]);

  React.useEffect(
    () => () => {
      void closeRuntime(runtime.scope).catch(noop);
    },
    [runtime]
  );

  return React.createElement(EffectSolanaRuntimeContext.Provider, { value: runtime }, children);
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
