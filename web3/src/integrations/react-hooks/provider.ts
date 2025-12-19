"use client";

import { constVoid as noop } from "effect/Function";
import type * as Layer from "effect/Layer";
import * as React from "react";
import type { EffectWeb3Runtime } from "./internal/runtime.js";
import { buildRuntime, buildRuntimeSync, closeRuntime } from "./internal/runtime.js";

export type EffectWeb3ProviderProps = {
  readonly children?: React.ReactNode;
  readonly fallback?: React.ReactNode;
  readonly layer: Layer.Layer<never, unknown, never>;
  readonly onUnhandledError?: (cause: unknown) => void;
};

export type EffectWeb3LayerProviderProps = {
  readonly children?: React.ReactNode;
  readonly layer: Layer.Layer<never, unknown, never>;
};

const EffectWeb3RuntimeContext = React.createContext<EffectWeb3Runtime | null>(null);
const EffectWeb3LayerContext = React.createContext<Layer.Layer<never, unknown, never> | null>(null);

export const EffectWeb3Provider = (props: EffectWeb3ProviderProps): React.ReactElement => {
  const { children, fallback = null, layer, onUnhandledError } = props;

  const [runtime, setRuntime] = React.useState<EffectWeb3Runtime | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let current: EffectWeb3Runtime | null = null;

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

  return React.createElement(EffectWeb3RuntimeContext.Provider, { value: runtime }, children);
};

export const EffectWeb3ProviderSync = (props: EffectWeb3ProviderProps): React.ReactElement => {
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

  return React.createElement(EffectWeb3RuntimeContext.Provider, { value: runtime }, children);
};

export const EffectWeb3LayerProvider = (
  props: EffectWeb3LayerProviderProps
): React.ReactElement => {
  const { children, layer } = props;
  return React.createElement(EffectWeb3LayerContext.Provider, { value: layer }, children);
};

export const useEffectWeb3Runtime = (): EffectWeb3Runtime => {
  const runtime = React.useContext(EffectWeb3RuntimeContext);
  if (runtime === null) {
    throw new Error("EffectWeb3Provider is missing (useEffectWeb3Runtime)");
  }
  return runtime;
};

export const useEffectWeb3Layer = (): Layer.Layer<never, unknown, never> => {
  const layer = React.useContext(EffectWeb3LayerContext);
  if (layer === null) {
    throw new Error("EffectWeb3LayerProvider is missing (useEffectWeb3Layer)");
  }
  return layer;
};
