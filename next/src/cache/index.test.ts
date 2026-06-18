import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { vi } from "vitest";

/**
 * Note: These tests mock React's cache() function and server-only since we're not in a React environment.
 * The actual behavior of React's cache() (request-scoped deduplication) cannot be fully
 * tested without a Next.js runtime. These tests verify the wrapper functions work correctly.
 */

// Mock server-only to prevent import errors
vi.mock("server-only", () => ({}));

// Mock React's cache function to pass through the function
vi.mock("react", () => ({
  cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

// Import after mocks are set up
const { reactCache, reactCacheFn, reactCacheWithKey } = await import("./index.js");

describe("reactCache", () => {
  it("executes effect and returns result", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const effect = Effect.succeed("cached-value");
    const cached = reactCache(effect, runtime);

    const result = await cached();
    expect(result).toBe("cached-value");

    await runtime.dispose();
  });

  it("executes effect with side effects", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    let callCount = 0;

    const effect = Effect.sync(() => {
      callCount += 1;
      return `call-${callCount}`;
    });

    const cached = reactCache(effect, runtime);

    const result1 = await cached();
    const result2 = await cached();

    // Without React's actual cache(), each call executes the effect
    expect(callCount).toBeGreaterThan(0);
    expect(result1).toContain("call-");
    expect(result2).toContain("call-");

    await runtime.dispose();
  });

  it("handles effect failures", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const effect = Effect.fail(new Error("cache error"));
    const cached = reactCache(effect, runtime);

    await expect(cached()).rejects.toThrow("cache error");

    await runtime.dispose();
  });

  it("works with services", async () => {
    class TestService extends Effect.Service<TestService>()("TestService", {
      effect: Effect.succeed({
        _tag: "TestService",
        getValue: () => "service-value",
      }),
    }) {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      getValue: () => "service-value",
    });
    const runtime = ManagedRuntime.make(layer);

    const effect = Effect.gen(function* () {
      const service = yield* TestService;
      return service.getValue();
    });

    const cached = reactCache(effect, runtime);
    const result = await cached();

    expect(result).toBe("service-value");

    await runtime.dispose();
  });
});

describe("reactCacheFn", () => {
  it("executes effect with parameters", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const effectFn = (x: number) => Effect.succeed(x * 2);
    const cached = reactCacheFn(effectFn, runtime);

    const result = await cached(5);
    expect(result).toBe(10);

    await runtime.dispose();
  });

  it("handles multiple parameters", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const effectFn = (a: number, b: string, c: boolean) => Effect.succeed(`${a}-${b}-${c}`);
    const cached = reactCacheFn(effectFn, runtime);

    const result = await cached(42, "test", true);
    expect(result).toBe("42-test-true");

    await runtime.dispose();
  });

  it("handles string parameters", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const effectFn = (id: string) => Effect.succeed(`result-${id}`);
    const cached = reactCacheFn(effectFn, runtime);

    const result1 = await cached("123");
    const result2 = await cached("456");

    expect(result1).toBe("result-123");
    expect(result2).toBe("result-456");

    await runtime.dispose();
  });

  it("handles effect failures", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const effectFn = (x: number) =>
      x > 0 ? Effect.succeed(x) : Effect.fail(new Error("invalid input"));
    const cached = reactCacheFn(effectFn, runtime);

    const result = await cached(5);
    expect(result).toBe(5);

    await expect(cached(-1)).rejects.toThrow("invalid input");

    await runtime.dispose();
  });

  it("works with services", async () => {
    class TestService extends Effect.Service<TestService>()("TestService", {
      effect: Effect.succeed({
        _tag: "TestService",
        multiply: (x: number) => x * 10,
      }),
    }) {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      multiply: (x: number) => x * 10,
    });
    const runtime = ManagedRuntime.make(layer);

    const effectFn = (x: number) =>
      Effect.gen(function* () {
        const service = yield* TestService;
        return service.multiply(x);
      });

    const cached = reactCacheFn(effectFn, runtime);
    const result = await cached(3);

    expect(result).toBe(30);

    await runtime.dispose();
  });

  it("handles object parameters", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    const effectFn = (opts: { id: string; count: number }) =>
      Effect.succeed(`${opts.id}:${opts.count}`);
    const cached = reactCacheFn(effectFn, runtime);

    const result = await cached({ count: 5, id: "test" });
    expect(result).toBe("test:5");

    await runtime.dispose();
  });
});

describe("reactCacheWithKey", () => {
  it("uses custom key for caching", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);
    let callCount = 0;

    const effectFn = (id: string) =>
      Effect.sync(() => {
        callCount += 1;
        return `result-${id}`;
      });

    const cached = reactCacheWithKey(effectFn, (id) => `key-${id}`, runtime);

    const result = await cached("test");
    expect(result).toBe("result-test");
    expect(callCount).toBeGreaterThan(0);

    await runtime.dispose();
  });

  it("deduplicates by custom key, not by object reference", async () => {
    // This test verifies the fix: different object references with the same
    // semantic key should hit the cache.
    //
    // Note: With the mock that passes through, we can't test actual React cache
    // deduplication. This test documents the intended behavior and verifies
    // the key generation works correctly.
    const runtime = ManagedRuntime.make(Layer.empty);

    type Options = { userId: string; includeDeleted?: boolean };

    const effectFn = (opts: Options) => Effect.succeed(`user:${opts.userId}`);

    const cached = reactCacheWithKey(
      effectFn,
      (opts) => `user:${opts.userId}:${opts.includeDeleted ?? false}`,
      runtime
    );

    // Two different object references with same semantic content
    const opts1 = { includeDeleted: false, userId: "123" };
    const opts2 = { includeDeleted: false, userId: "123" };

    // Verify they're different references
    expect(opts1).not.toBe(opts2);

    const result1 = await cached(opts1);
    const result2 = await cached(opts2);

    // Both should return the same result
    expect(result1).toBe("user:123");
    expect(result2).toBe("user:123");

    // With pass-through mock, both calls execute. In production with React's
    // cache(), the second call would return the cached result.

    await runtime.dispose();
  });

  it("generates keys from multiple parameters", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);

    const effectFn = (userId: string, includeDeleted: boolean) =>
      Effect.succeed(`${userId}:${includeDeleted}`);

    const cached = reactCacheWithKey(
      effectFn,
      (userId, includeDeleted) => `user:${userId}:${includeDeleted}`,
      runtime
    );

    const result1 = await cached("123", true);
    const result2 = await cached("456", false);

    expect(result1).toBe("123:true");
    expect(result2).toBe("456:false");

    await runtime.dispose();
  });

  it("handles complex key generation", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);

    type QueryOptions = {
      userId: string;
      includeDeleted?: boolean;
    };

    const effectFn = (options: QueryOptions) => Effect.succeed(`user:${options.userId}`);

    const cached = reactCacheWithKey(
      effectFn,
      (options) => `user:${options.userId}:${options.includeDeleted ?? false}`,
      runtime
    );

    const result1 = await cached({ userId: "123" });
    const result2 = await cached({ includeDeleted: true, userId: "123" });

    expect(result1).toBe("user:123");
    expect(result2).toBe("user:123");

    await runtime.dispose();
  });

  it("handles effect failures", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);

    const effectFn = (id: string) =>
      id === "invalid" ? Effect.fail(new Error("invalid id")) : Effect.succeed(id);

    const cached = reactCacheWithKey(effectFn, (id) => `key-${id}`, runtime);

    const result = await cached("valid");
    expect(result).toBe("valid");

    await expect(cached("invalid")).rejects.toThrow("invalid id");

    await runtime.dispose();
  });

  it("works with services", async () => {
    class TestService extends Effect.Service<TestService>()("TestService", {
      effect: Effect.succeed({
        _tag: "TestService",
        format: (id: string) => `formatted-${id}`,
      }),
    }) {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      format: (id: string) => `formatted-${id}`,
    });
    const runtime = ManagedRuntime.make(layer);

    const effectFn = (id: string) =>
      Effect.gen(function* () {
        const service = yield* TestService;
        return service.format(id);
      });

    const cached = reactCacheWithKey(effectFn, (id) => `key-${id}`, runtime);
    const result = await cached("test");

    expect(result).toBe("formatted-test");

    await runtime.dispose();
  });

  it("handles array parameters in key generation", async () => {
    const runtime = ManagedRuntime.make(Layer.empty);

    const effectFn = (ids: string[]) => Effect.succeed(ids.join(","));

    const cached = reactCacheWithKey(effectFn, (ids) => `keys:${ids.join(":")}`, runtime);

    const result = await cached(["a", "b", "c"]);
    expect(result).toBe("a,b,c");

    await runtime.dispose();
  });
});
