import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { vi } from "vitest";

/**
 * Note: These tests verify the Next handler builder functionality
 * including constructor behavior, middleware composition, and build execution.
 */

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock executor to avoid Next.js internals dependency
vi.mock("../internal/executor.js", () => ({
  executeWithRuntime: vi.fn((runtime, effect) => {
    if (runtime) {
      return runtime.runPromise(effect);
    }
    return Effect.runPromise(effect);
  }),
}));

// Import after mocks
const { make, makeWithRuntime, TypeId } = await import("./next.js");
const { executeWithRuntime } = await import("../internal/executor.js");
const Middleware = await import("../middleware/index.js");

describe("Next handler constructors", () => {
  it("make() sets _tag, key, empty middlewares, and creates runtime", async () => {
    class TestService extends Effect.Service<TestService>()("TestService", {
      effect: Effect.succeed({
        _tag: "TestService",
        getValue: () => "test-value",
      }),
    }) {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      getValue: () => "test-value",
    });

    const handler = make("TestHandler", layer);

    expect(handler._tag).toBe("TestHandler");
    expect(handler.key).toBe("effect-next/Next/TestHandler");
    expect(handler.middlewares).toEqual([]);
    expect(handler.runtime).toBeDefined();

    // Clean up runtime
    if (handler.runtime) {
      await handler.runtime.dispose();
    }
  });

  it("makeWithRuntime() keeps runtime by reference", () => {
    class TestService extends Effect.Service<TestService>()("TestService", {
      effect: Effect.succeed({
        _tag: "TestService",
        getValue: () => "test-value",
      }),
    }) {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      getValue: () => "test-value",
    });
    const runtime = ManagedRuntime.make(layer);

    const handler = makeWithRuntime("TestHandler", runtime);

    expect(handler._tag).toBe("TestHandler");
    expect(handler.key).toBe("effect-next/Next/TestHandler");
    expect(handler.middlewares).toEqual([]);
    expect(handler.runtime).toBe(runtime);
  });

  it("has TypeId present", async () => {
    const layer = Layer.empty;
    const handler = make("TestHandler", layer);

    expect((handler as any)[TypeId]).toBe(TypeId);

    if (handler.runtime) {
      await handler.runtime.dispose();
    }
  });
});

describe("Next handler .middleware()", () => {
  it("returns a new handler (immutability)", async () => {
    // Use a simple middleware without provides to avoid complex type constraints
    class TestMiddleware extends Middleware.Tag<TestMiddleware>()("TestMiddleware") {}

    const layer = Layer.succeed(TestMiddleware, () => Effect.succeed(undefined));

    const handler1 = make("TestHandler", layer);
    const handler2 = (handler1 as any).middleware(TestMiddleware);

    // Original unchanged
    expect(handler1.middlewares).toEqual([]);
    // New handler has middleware
    expect(handler2.middlewares).toHaveLength(1);
    expect(handler2.middlewares[0]).toBe(TestMiddleware);

    // Clean up
    if (handler1.runtime) {
      await handler1.runtime.dispose();
    }
  });

  it("preserves insertion order in middlewares array", async () => {
    class Middleware1 extends Middleware.Tag<Middleware1>()("Middleware1") {}
    class Middleware2 extends Middleware.Tag<Middleware2>()("Middleware2") {}

    const layer = Layer.mergeAll(
      Layer.succeed(Middleware1, () => Effect.succeed(undefined)),
      Layer.succeed(Middleware2, () => Effect.succeed(undefined))
    );

    const handler = (make("TestHandler", layer) as any)
      .middleware(Middleware1)
      .middleware(Middleware2);

    expect(handler.middlewares).toHaveLength(2);
    expect(handler.middlewares[0]).toBe(Middleware1);
    expect(handler.middlewares[1]).toBe(Middleware2);

    // Clean up
    if (handler.runtime) {
      await handler.runtime.dispose();
    }
  });
});

describe("Next handler .build()", () => {
  it("without middleware: runs handler effect and returns value", async () => {
    const layer = Layer.empty;
    const handler = make("TestHandler", layer);

    const fn = handler.build(() => Effect.succeed("hello"));
    const result = await fn();

    expect(result).toBe("hello");
    expect(executeWithRuntime).toHaveBeenCalled();

    // Clean up
    if (handler.runtime) {
      await handler.runtime.dispose();
    }
  });

  it("with runtime: executes handler and returns value", async () => {
    class TestService extends Effect.Service<TestService>()("TestService", {
      effect: Effect.succeed({
        _tag: "TestService",
        getValue: () => "test-value",
      }),
    }) {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      getValue: () => "test-value",
    });
    const runtime = ManagedRuntime.make(layer);

    const handler = makeWithRuntime("TestHandler", runtime);

    const fn = handler.build(() =>
      Effect.gen(function* () {
        const service = yield* TestService;
        return service.getValue();
      })
    );

    const result = await fn();

    expect(result).toBe("test-value");

    // Clean up runtime
    await runtime.dispose();
  });

  it("handles failed effects", async () => {
    const layer = Layer.empty;
    const handler = make("TestHandler", layer);

    const fn = handler.build(
      () => Effect.fail(new Error("test error")) as Effect.Effect<never, never, never>
    );

    await expect(fn()).rejects.toThrow("test error");

    // Clean up
    if (handler.runtime) {
      await handler.runtime.dispose();
    }
  });

  it("handles sync effects", async () => {
    const layer = Layer.empty;
    const handler = make("TestHandler", layer);

    const fn = handler.build(() => Effect.sync(() => "sync-value"));
    const result = await fn();

    expect(result).toBe("sync-value");

    // Clean up
    if (handler.runtime) {
      await handler.runtime.dispose();
    }
  });

  it("passes arguments to handler function", async () => {
    const layer = Layer.empty;
    const handler = make("TestHandler", layer);

    const fn = handler.build((name: string, age: number) => Effect.succeed(`${name} is ${age}`));

    const result = await fn("Alice", 30);

    expect(result).toBe("Alice is 30");

    // Clean up
    if (handler.runtime) {
      await handler.runtime.dispose();
    }
  });
});
