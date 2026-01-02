// @vitest-environment jsdom

import { Effect, Layer } from "effect";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { EffectEvmRuntime } from "./internal/runtime.js";
import { useEffectMemoFactory } from "./primitives.js";
import {
  EffectEvmLayerProvider,
  EffectEvmProviderSync,
  useEffectEvmLayer,
  useEffectEvmRuntime,
} from "./provider.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const globalWithAct = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
globalWithAct.IS_REACT_ACT_ENVIRONMENT = true;

const render = (node: React.ReactElement) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => {
    root.render(node);
  });
  return {
    cleanup: () => {
      void act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe("react-hooks provider", () => {
  it("EffectEvmProviderSync exposes runtime with runPromiseExit", async () => {
    const runtimeRef: { current: EffectEvmRuntime | null } = { current: null };

    const Probe = (): null => {
      const runtime = useEffectEvmRuntime();
      React.useEffect(() => {
        runtimeRef.current = runtime;
      }, [runtime]);
      return null;
    };

    const { cleanup } = render(
      React.createElement(EffectEvmProviderSync, {
        children: React.createElement(Probe),
        layer: Layer.empty,
      })
    );

    await act(async () => {
      await flush();
    });

    expect(runtimeRef.current?.runPromiseExit).toBeTypeOf("function");
    cleanup();
  });

  it("EffectEvmLayerProvider supplies the layer", async () => {
    const layer: Layer.Layer<never, unknown, never> = Layer.empty;
    const seen: { current: Layer.Layer<never, unknown, never> | null } = { current: null };

    const Probe = (): null => {
      const provided = useEffectEvmLayer();
      React.useEffect(() => {
        seen.current = provided;
      }, [provided]);
      return null;
    };

    const { cleanup } = render(
      React.createElement(EffectEvmLayerProvider, {
        children: React.createElement(Probe),
        layer,
      })
    );

    await act(async () => {
      await flush();
    });

    expect(seen.current).toBe(layer);
    cleanup();
  });
});

describe("useEffectMemoFactory", () => {
  it("runs effect and updates value", async () => {
    const values: Array<number | undefined> = [];

    const Probe = (): null => {
      const value = useEffectMemoFactory(() => Effect.succeed(456), [], { transition: false });

      React.useEffect(() => {
        values.push(value);
      }, [value]);

      return null;
    };

    const { cleanup } = render(
      React.createElement(EffectEvmProviderSync, {
        children: React.createElement(Probe),
        layer: Layer.empty,
      })
    );

    await act(async () => {
      await flush();
      await flush();
    });

    expect(values.at(-1)).toBe(456);
    cleanup();
  });
});
