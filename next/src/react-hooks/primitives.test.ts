// @vitest-environment jsdom

import { Cause, Effect, Layer, ManagedRuntime, Stream } from "effect";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffectMemo, useEffectOnce, useStream, useStreamLatest } from "./primitives.js";

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function makeRuntime() {
  const runtime = ManagedRuntime.make(Layer.empty);
  cleanup.push(() => runtime.dispose());
  await runtime.runPromise(Effect.void);
  return runtime;
}

function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function rerender(next: React.ReactNode) {
    void act(() => root.render(next));
  }
  cleanup.push(() => {
    void act(() => root.unmount());
    container.remove();
  });
  rerender(node);
  return { container, rerender };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("effect hooks", () => {
  it("surfaces the first typed memo failure in a mixed Cause", async () => {
    const runtime = await makeRuntime();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    cleanup.push(() => {
      errorLog.mockRestore();
    });
    const cause = Cause.fromReasons([
      Cause.makeDieReason(new Error("defect")),
      Cause.makeFailReason("first typed failure"),
      Cause.makeInterruptReason(),
      Cause.makeFailReason("second typed failure"),
    ]);
    function Probe() {
      useEffectMemo(() => Effect.failCause(cause), [], runtime);
      return React.createElement("span", null, "pending");
    }
    class Boundary extends React.Component<{ children?: React.ReactNode }, { error?: unknown }> {
      state: { error?: unknown } = {};
      static getDerivedStateFromError(error: unknown) {
        return { error };
      }
      render() {
        return this.state.error === undefined ? this.props.children : String(this.state.error);
      }
    }
    const { container } = render(React.createElement(Boundary, null, React.createElement(Probe)));
    await flush();
    expect(container.textContent).toBe("first typed failure");
  });

  it("ignores interruption-only memo exits", async () => {
    const runtime = await makeRuntime();
    function Probe() {
      const value = useEffectMemo(() => Effect.interrupt, [], runtime);
      return React.createElement("span", null, value ?? "pending");
    }
    const { container } = render(React.createElement(Probe));
    await flush();
    expect(container.textContent).toBe("pending");
  });

  it("completes useEffectOnce after StrictMode restarts its effect", async () => {
    const runtime = await makeRuntime();
    const effect = Effect.sleep("1 millis").pipe(Effect.as("ready"));
    function Probe() {
      return React.createElement("span", null, useEffectOnce(effect, runtime) ?? "pending");
    }
    const { container } = render(
      React.createElement(React.StrictMode, null, React.createElement(Probe))
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.textContent).toBe("ready");
  });

  it("does not cancel useEffectOnce when an inline effect changes identity", async () => {
    const runtime = await makeRuntime();
    let complete: ((value: string) => void) | undefined;
    const promise = new Promise<string>((resolve) => {
      complete = resolve;
    });
    function Probe() {
      const value = useEffectOnce(
        Effect.promise(() => promise),
        runtime
      );
      return React.createElement("span", null, value ?? "pending");
    }
    const { container, rerender } = render(React.createElement(Probe));
    rerender(React.createElement(Probe));
    complete?.("ready");
    await flush();
    expect(container.textContent).toBe("ready");
  });

  it("ignores a completed previous memo run after dependencies change", async () => {
    const runtime = await makeRuntime();
    function Probe({ id }: { id: number }) {
      const value = useEffectMemo(
        () => (id === 1 ? Effect.succeed("old") : Effect.never),
        [id],
        runtime
      );
      return React.createElement("span", null, value ?? "pending");
    }
    const { container, rerender } = render(React.createElement(Probe, { id: 1 }));
    rerender(React.createElement(Probe, { id: 2 }));
    await flush();
    expect(container.textContent).toBe("pending");
  });

  it("retains no stream values when maxItems is zero", async () => {
    const runtime = await makeRuntime();
    const stream = Stream.make(1, 2, 3);
    function Probe() {
      return React.createElement(
        "span",
        null,
        JSON.stringify(useStream(stream, runtime, { maxItems: 0 }))
      );
    }
    const { container } = render(React.createElement(Probe));
    await flush();
    expect(container.textContent).toBe("[]");
  });

  it.each(["all", "latest"])("surfaces falsy stream failures in %s mode", async (mode) => {
    const runtime = await makeRuntime();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    cleanup.push(() => {
      errorLog.mockRestore();
    });
    const stream = Stream.fail(0);
    function Probe() {
      if (mode === "all") useStream(stream, runtime);
      else useStreamLatest(stream, runtime, "initial");
      return React.createElement("span", null, "running");
    }
    class Boundary extends React.Component<{ children?: React.ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? "failed" : this.props.children;
      }
    }
    const { container } = render(React.createElement(Boundary, null, React.createElement(Probe)));
    await flush();
    expect(container.textContent).toBe("failed");
  });
});
