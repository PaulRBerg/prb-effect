// @vitest-environment jsdom

import { Context, Effect, Layer } from "effect";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EffectSolanaProviderSync, useEffectSolanaRuntime } from "./provider.js";

type Resource = { readonly name: string; closed: boolean };
const Resource = Context.GenericTag<Resource>("provider-test-resource");
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
});

function resourceLayer(name: string, acquired: Resource[]) {
  return Layer.scoped(
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

describe("EffectSolanaProviderSync lifecycle", () => {
  it("renders fallback on the server without acquiring resources", () => {
    const acquired: Resource[] = [];
    const html = renderToString(
      React.createElement(EffectSolanaProviderSync, {
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
        React.createElement(EffectSolanaProviderSync, {
          layer: resourceLayer("abandoned", acquired),
        }),
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
      const runtime = useEffectSolanaRuntime();
      React.useEffect(() => {
        void runtime.runPromise(Resource).then((resource) => seen.push(resource));
      }, [runtime]);
      return "ready";
    }
    const container = await mount(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(EffectSolanaProviderSync, {
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
      const runtime = useEffectSolanaRuntime();
      React.useLayoutEffect(() => {
        void runtime
          .runPromise(Resource)
          .then((resource) => seen.push(`${expected}:${resource.name}:${resource.closed}`));
      }, [runtime, expected]);
      return "ready";
    }
    function tree(replaced: boolean) {
      const layer = replaced && dependency === "layer" ? secondLayer : firstLayer;
      return React.createElement(EffectSolanaProviderSync, {
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
    const layer = Layer.scopedDiscard(
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
        React.createElement(EffectSolanaProviderSync, { layer, onUnhandledError })
      )
    );
    expect(container.textContent).toBe("failed");
    expect(onUnhandledError).toHaveBeenCalledOnce();
    expect(String(onUnhandledError.mock.calls[0]?.[0])).toContain("layer failed");
    expect(acquired).toHaveLength(1);
    expect(acquired[0]?.closed).toBe(true);
  });
});
