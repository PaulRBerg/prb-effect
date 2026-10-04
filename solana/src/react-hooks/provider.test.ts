// @vitest-environment jsdom

import { Context, Effect, Layer, SubscriptionRef } from "effect";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSubscriptionRef } from "./primitives/use-stream.js";
import {
  EffectSolanaProvider,
  EffectSolanaProviderSync,
  useEffectSolanaRuntime,
} from "./provider.js";

type Resource = { readonly name: string; closed: boolean };
const Resource = Context.Service<Resource>("provider-test-resource");
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
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

describe("EffectSolanaProvider lifecycle", () => {
  it.each([
    "unmount",
    "layer",
    "onUnhandledError",
  ] as const)("interrupts pending acquisition on %s and releases resources without reporting cleanup", async (change) => {
    const acquired: Resource[] = [];
    const started = Promise.withResolvers<void>();
    const finalizing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const finalized = Promise.withResolvers<void>();
    const interrupted = vi.fn();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const pendingLayer = Layer.effect(
      Resource,
      Effect.gen(function* () {
        const resource = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const value = { closed: false, name: acquired.length === 0 ? "pending" : "replayed" };
            acquired.push(value);
            return value;
          }),
          (value) =>
            Effect.promise(async () => {
              if (value.name === "pending") {
                finalizing.resolve();
                await release.promise;
              }
              value.closed = true;
              if (value.name === "pending") finalized.resolve();
            })
        );
        if (resource.name === "pending") {
          yield* Effect.callback<void>(() => {
            started.resolve();
            return Effect.sync(interrupted);
          });
        }
        return resource;
      })
    );
    function tree(replaced: boolean) {
      return React.createElement(EffectSolanaProvider, {
        children: "ready",
        fallback: "pending",
        layer:
          replaced && change === "layer" ? resourceLayer("replacement", acquired) : pendingLayer,
        onUnhandledError: replaced && change === "onUnhandledError" ? secondHandler : firstHandler,
      });
    }
    const container = await mount(tree(false));
    try {
      await started.promise;
      expect(container.textContent).toBe("pending");
      await act(() => {
        if (change === "unmount") {
          root?.unmount();
          root = undefined;
        } else {
          root?.render(tree(true));
        }
      });
      await finalizing.promise;
      expect(interrupted).toHaveBeenCalledOnce();
      expect(acquired[0]?.closed).toBe(false);
      expect(container.textContent).toBe(change === "unmount" ? "" : "ready");
      await act(async () => {
        release.resolve();
        await finalized.promise;
      });
      expect(acquired[0]?.closed).toBe(true);
      expect(firstHandler).not.toHaveBeenCalled();
      expect(secondHandler).not.toHaveBeenCalled();
      if (change !== "unmount") {
        expect(acquired).toHaveLength(2);
        expect(acquired[1]?.closed).toBe(false);
        expect(container.textContent).toBe("ready");
      }
    } finally {
      release.resolve();
    }
  });

  it.each([
    "layer",
    "onUnhandledError",
  ] as const)("hides the stale runtime during child render when %s changes", async (dependency) => {
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
      const resource = Effect.runSyncWith(runtime.context)(Resource);
      seen.push(`${expected}:${resource.name}:${resource.closed}`);
      return "ready";
    }
    function tree(replaced: boolean) {
      return React.createElement(EffectSolanaProvider, {
        children: React.createElement(Probe, { expected: replaced ? "new" : "old" }),
        fallback: React.createElement(Fallback),
        layer: replaced && dependency === "layer" ? secondLayer : firstLayer,
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

  it("does not revive a closed runtime when returning from pending replacement to the original layer", async () => {
    const acquired: Resource[] = [];
    const seen: Resource[] = [];
    const firstLayer = resourceLayer("first", acquired);
    const pendingLayer = Layer.effectDiscard(Effect.never);
    const onUnhandledError = vi.fn();
    function Probe() {
      const runtime = useEffectSolanaRuntime();
      seen.push(Effect.runSyncWith(runtime.context)(Resource));
      return "ready";
    }
    function tree(layer: typeof firstLayer | typeof pendingLayer) {
      return React.createElement(EffectSolanaProvider, {
        children: React.createElement(Probe),
        fallback: "pending",
        layer,
        onUnhandledError,
      });
    }
    const container = await mount(tree(firstLayer));
    expect(seen).toEqual([acquired[0]]);
    await act(async () => root?.render(tree(pendingLayer)));
    expect(container.textContent).toBe("pending");
    expect(acquired[0]?.closed).toBe(true);
    await act(async () => root?.render(tree(firstLayer)));
    expect(container.textContent).toBe("ready");
    expect(acquired).toHaveLength(2);
    expect(seen).toEqual([acquired[0], acquired[1]]);
    expect(acquired[1]?.closed).toBe(false);
    expect(onUnhandledError).not.toHaveBeenCalled();
  });

  it("reports the original failed acquisition after releasing partial resources", async () => {
    const acquired: Resource[] = [];
    const onUnhandledError = vi.fn();
    const error = new Error("async layer failed");
    const layer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* Layer.build(resourceLayer("failed", acquired));
        return yield* Effect.fail(error);
      })
    );
    const container = await mount(
      React.createElement(EffectSolanaProvider, { fallback: "pending", layer, onUnhandledError })
    );
    expect(container.textContent).toBe("pending");
    expect(onUnhandledError).toHaveBeenCalledExactlyOnceWith(error);
    expect(acquired).toHaveLength(1);
    expect(acquired[0]?.closed).toBe(true);
  });

  it("keeps the current acquisition live through StrictMode replay", async () => {
    const acquired: Resource[] = [];
    const onUnhandledError = vi.fn();
    const container = await mount(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(EffectSolanaProvider, {
          children: "ready",
          fallback: "pending",
          layer: resourceLayer("strict", acquired),
          onUnhandledError,
        })
      )
    );
    expect(container.textContent).toBe("ready");
    expect(acquired.map((resource) => resource.closed)).toEqual([true, false]);
    expect(onUnhandledError).not.toHaveBeenCalled();
    await act(async () => root?.unmount());
    root = undefined;
    expect(acquired.every((resource) => resource.closed)).toBe(true);
  });
});

describe("EffectSolanaProviderSync lifecycle", () => {
  it("keeps subscription renders stable and follows a replacement ref", async () => {
    const first = Effect.runSync(SubscriptionRef.make(1));
    const second = Effect.runSync(SubscriptionRef.make(10));
    function Probe({ ref }: { readonly ref: SubscriptionRef.SubscriptionRef<number> }) {
      return String(useSubscriptionRef(ref, 0));
    }
    function tree(ref: SubscriptionRef.SubscriptionRef<number>) {
      return React.createElement(EffectSolanaProviderSync, {
        children: React.createElement(Probe, { ref }),
        layer: Layer.empty,
      });
    }

    const container = await mount(tree(first));
    expect(container.textContent).toBe("1");
    await act(async () => {
      await Effect.runPromise(SubscriptionRef.set(first, 2));
    });
    expect(container.textContent).toBe("2");

    await act(async () => root?.render(tree(second)));
    expect(container.textContent).toBe("10");
    await act(async () => {
      await Effect.runPromise(SubscriptionRef.set(first, 3));
      await Effect.runPromise(SubscriptionRef.set(second, 11));
    });
    expect(container.textContent).toBe("11");
  });

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
