import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { vi } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

// Import after mocks
const { createStatefulRuntime, createStatefulContext } = await import("./index.js");

// Simple test service for basic tests
class SimpleService extends Effect.Service<SimpleService>()("SimpleService", {
  effect: Effect.succeed({
    _tag: "SimpleService",
    value: "test-value",
  }),
}) {}

const simpleLayer = Layer.succeed(SimpleService, {
  _tag: "SimpleService",
  value: "test-value",
});

describe("createStatefulRuntime", () => {
  afterEach(() => {
    // Clean up global runtime store
    const globalStore = globalThis as Record<string, unknown>;
    for (const key of Object.keys(globalStore)) {
      if (key.startsWith("effect-next/runtime/")) {
        delete globalStore[key];
      }
    }
    vi.restoreAllMocks();
  });

  it("returns the same runtime instance for same id (memoization)", async () => {
    const runtime1 = createStatefulRuntime(simpleLayer, { id: "test-1" });
    const runtime2 = createStatefulRuntime(simpleLayer, { id: "test-1" });

    // Reference equality check
    expect(runtime1).toBe(runtime2);

    await runtime1.dispose();
  });

  it("returns different runtime instances for different ids", async () => {
    const runtime1 = createStatefulRuntime(simpleLayer, { id: "test-1" });
    const runtime2 = createStatefulRuntime(simpleLayer, { id: "test-2" });

    // Different references
    expect(runtime1).not.toBe(runtime2);

    await runtime1.dispose();
    await runtime2.dispose();
  });

  it("uses default id when not specified", async () => {
    const runtime1 = createStatefulRuntime(simpleLayer);
    const runtime2 = createStatefulRuntime(simpleLayer, { id: "default" });

    // Should be same instance since both use "default" id
    expect(runtime1).toBe(runtime2);

    await runtime1.dispose();
  });

  it("registers SIGINT and SIGTERM shutdown hooks by default", () => {
    const onceSpy = vi.spyOn(process, "once");

    createStatefulRuntime(simpleLayer, { id: "shutdown-test-1" });

    expect(onceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(onceSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
  });

  it("does not register shutdown hooks when enableShutdownHooks is false", () => {
    const onceSpy = vi.spyOn(process, "once");

    createStatefulRuntime(simpleLayer, {
      enableShutdownHooks: false,
      id: "no-shutdown-test",
    });

    expect(onceSpy).not.toHaveBeenCalled();
  });

  it("survives HMR by storing in globalThis", async () => {
    const runtime = createStatefulRuntime(simpleLayer, { id: "hmr-test" });

    // Check that runtime is stored in globalThis
    const globalStore = globalThis as Record<string, unknown>;
    expect(globalStore["effect-next/runtime/hmr-test"]).toBe(runtime);

    await runtime.dispose();
  });

  it("works with custom layers", async () => {
    class TestService extends Effect.Service<TestService>()("TestService", {
      effect: Effect.succeed({
        _tag: "TestService",
        getValue: () => "custom-service-value",
      }),
    }) {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      getValue: () => "custom-service-value",
    });

    const runtime = createStatefulRuntime(layer, { id: "custom-layer-test" });

    const effect = Effect.gen(function* () {
      const service = yield* TestService;
      return service.getValue();
    });

    const result = await runtime.runPromise(effect);
    expect(result).toBe("custom-service-value");

    await runtime.dispose();
  });
});

describe("createStatefulContext", () => {
  afterEach(() => {
    // Clean up global runtime store
    const globalStore = globalThis as Record<string, unknown>;
    for (const key of Object.keys(globalStore)) {
      if (key.startsWith("effect-next/runtime/")) {
        delete globalStore[key];
      }
    }
    vi.restoreAllMocks();
  });

  it("returns runtime.runtimeEffect", async () => {
    const runtime = createStatefulRuntime(simpleLayer, {
      id: "context-test-1",
    });
    const context = createStatefulContext(runtime);

    // Check reference equality
    expect(context).toBe(runtime.runtimeEffect);

    await runtime.dispose();
  });

  it("context can be used to access runtime services", async () => {
    class TestService extends Effect.Service<TestService>()("TestService", {
      effect: Effect.succeed({
        _tag: "TestService",
        getData: () => "context-data",
      }),
    }) {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      getData: () => "context-data",
    });

    const runtime = createStatefulRuntime(layer, { id: "context-test-2" });
    const context = createStatefulContext(runtime);

    const effect = Effect.gen(function* () {
      const ctx = yield* context;
      const service = yield* Effect.provide(TestService, ctx);
      return service.getData();
    });

    const result = await Effect.runPromise(effect);
    expect(result).toBe("context-data");

    await runtime.dispose();
  });
});
