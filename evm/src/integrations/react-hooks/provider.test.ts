// @vitest-environment jsdom

import { Context, Effect, Layer } from "effect";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
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

type Resource = { readonly name: string; closed: boolean };
const Resource = Context.Service<Resource>("provider-test-resource");
let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
});

function resourceLayer(name: string, acquired: Resource[]) {
  return Layer.effect(
    Resource,
    Effect.acquireRelease(
      Effect.sync(() => {
        const resource = { closed: false, name };
        acquired.push(resource);
        return resource;
      }),
      (resource) =>
        Effect.sync(() => {
          resource.closed = true;
        })
    )
  );
}

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container;
}

describe("EffectEvmProviderSync lifecycle", () => {
  it("renders fallback on the server without acquiring resources", () => {
    const acquired: Resource[] = [];
    const html = renderToString(
      React.createElement(EffectEvmProviderSync, {
        children: "ready",
        fallback: "pending",
        layer: resourceLayer("server", acquired),
      })
    );
    expect(acquired).toEqual([]);
    expect(html).toBe("pending");
  });

  it("does not acquire resources in a suspended, uncommitted render", async () => {
    const acquired: Resource[] = [];
    const pending = new Promise<never>(() => undefined);
    function Suspend(): never {
      throw pending;
    }
    const container = await mount(
      React.createElement(
        React.Suspense,
        { fallback: "suspended" },
        React.createElement(EffectEvmProviderSync, { layer: resourceLayer("abandoned", acquired) }),
        React.createElement(Suspend)
      )
    );
    expect(container.textContent).toBe("suspended");
    expect(acquired).toEqual([]);
  });

  it("keeps the committed runtime live through StrictMode replay and releases every acquisition", async () => {
    const acquired: Resource[] = [];
    const seen: Resource[] = [];
    function Probe() {
      const runtime = useEffectEvmRuntime();
      React.useEffect(() => {
        void runtime.runPromise(Resource).then((resource) => seen.push(resource));
      }, [runtime]);
      return "ready";
    }
    const container = await mount(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(EffectEvmProviderSync, {
          children: React.createElement(Probe),
          layer: resourceLayer("strict", acquired),
        })
      )
    );
    expect(container.textContent).toBe("ready");
    expect(acquired).toHaveLength(2);
    expect(seen.at(-1)?.closed).toBe(false);
    expect(acquired.map((resource) => resource.closed)).toEqual([true, false]);
    await act(async () => root?.unmount());
    root = undefined;
    expect(acquired.every((resource) => resource.closed)).toBe(true);
  });

  it.each([
    "layer",
    "onUnhandledError",
  ] as const)("shows fallback instead of a stale runtime when %s changes", async (dependency) => {
    const acquired: Resource[] = [];
    const seen: string[] = [];
    const firstLayer = resourceLayer("first", acquired);
    const secondLayer = resourceLayer("second", acquired);
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    function Fallback() {
      seen.push("fallback");
      return "pending";
    }
    function Probe({ expected }: { readonly expected: string }) {
      const runtime = useEffectEvmRuntime();
      React.useLayoutEffect(() => {
        void runtime
          .runPromise(Resource)
          .then((resource) => seen.push(`${expected}:${resource.name}:${resource.closed}`));
      }, [runtime, expected]);
      return "ready";
    }
    function tree(replaced: boolean) {
      const layer = replaced && dependency === "layer" ? secondLayer : firstLayer;
      return React.createElement(EffectEvmProviderSync, {
        children: React.createElement(Probe, { expected: replaced ? "new" : "old" }),
        fallback: React.createElement(Fallback),
        layer,
        onUnhandledError:
          replaced && dependency === "onUnhandledError" ? secondHandler : firstHandler,
      });
    }
    await mount(tree(false));
    expect(seen).toEqual(["fallback", "old:first:false"]);
    seen.length = 0;
    await act(async () => root?.render(tree(true)));
    expect(seen).toEqual(["fallback", `new:${dependency === "layer" ? "second" : "first"}:false`]);
    expect(acquired.map((resource) => resource.closed)).toEqual([true, false]);
  });

  it("reports build failure to the callback and React boundary while releasing partial resources", async () => {
    const acquired: Resource[] = [];
    const onUnhandledError = vi.fn();
    const error = new Error("layer failed");
    const layer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* Layer.build(resourceLayer("failed", acquired));
        return yield* Effect.fail(error);
      })
    );
    class Boundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? "failed" : this.props.children;
      }
    }
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const container = await mount(
      React.createElement(
        Boundary,
        null,
        React.createElement(EffectEvmProviderSync, { layer, onUnhandledError })
      )
    );
    expect(container.textContent).toBe("failed");
    expect(onUnhandledError).toHaveBeenCalledOnce();
    expect(String(onUnhandledError.mock.calls[0]?.[0])).toContain("layer failed");
    expect(acquired).toHaveLength(1);
    expect(acquired[0]?.closed).toBe(true);
  });
});
