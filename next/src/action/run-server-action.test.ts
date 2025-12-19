import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { vi } from "vitest";

/**
 * Note: These tests bypass the Next.js AsyncLocalStorage context by using
 * Effects that don't require AsyncContext dependencies. Full integration tests
 * would require a Next.js runtime environment.
 */

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock React
vi.mock("react", () => ({
  default: {
    unstable_postpone: vi.fn(),
  },
}));

// Mock Next.js internal modules
vi.mock("next/dist/client/components/unstable-rethrow.server.js", () => ({
  unstable_rethrow: vi.fn((error: unknown) => {
    // Just rethrow the error
    throw error;
  }),
}));

vi.mock("next/dist/server/app-render/work-async-storage.external.js", () => ({
  workAsyncStorage: {
    getStore: vi.fn(() => undefined),
  },
}));

vi.mock("next/dist/server/app-render/work-unit-async-storage.external.js", () => ({
  workUnitAsyncStorage: {
    getStore: vi.fn(() => undefined),
  },
}));

// Import after mocks
const { runServerAction, runServerActionOrThrow } = await import("./run-server-action.js");
const { ServerActionError } = await import("./types.js");

describe("runServerAction", () => {
  it("returns success result for successful effects", async () => {
    const effect = Effect.succeed("hello");
    const result = await runServerAction(effect);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("hello");
    }
  });

  it("returns success result with number value", async () => {
    const effect = Effect.succeed(42);
    const result = await runServerAction(effect);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(42);
    }
  });

  it("returns failure result for failed effects", async () => {
    const error = new Error("test error");
    const effect = Effect.fail(error);
    const result = await runServerAction(effect);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ServerActionError);
      expect(result.error.message).toContain("test error");
      expect(result.error.errorTag).toBe(null);
    }
  });

  it("extracts error tag from tagged errors", async () => {
    const effect = Effect.fail({ _tag: "NotFound", message: "Not found" });
    const result = await runServerAction(effect);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorTag).toBe("NotFound");
      // Error message includes the entire JSON stringified error
      expect(result.error.message).toContain("NotFound");
      expect(result.error.message).toContain("Not found");
    }
  });

  it("handles complex tagged errors", async () => {
    const effect = Effect.fail({
      _tag: "ValidationError",
      details: { field: "email" },
      message: "Invalid input",
    });
    const result = await runServerAction(effect);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errorTag).toBe("ValidationError");
      // Error message includes the entire JSON stringified error
      expect(result.error.message).toContain("ValidationError");
      expect(result.error.message).toContain("Invalid input");
    }
  });

  it("works with custom runtime", async () => {
    // Create a simple service for testing
    class TestService extends Effect.Service<TestService>()("TestService", {
      effect: Effect.succeed({
        _tag: "TestService",
        getValue: () => "custom-value",
      }),
    }) {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      getValue: () => "custom-value",
    });
    const runtime = ManagedRuntime.make(layer);

    const effect = Effect.gen(function* () {
      const service = yield* TestService;
      return service.getValue();
    });

    const result = await runServerAction(effect, { runtime });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("custom-value");
    }

    await runtime.dispose();
  });

  it("handles sync effects", async () => {
    const effect = Effect.sync(() => "sync-value");
    const result = await runServerAction(effect);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("sync-value");
    }
  });

  it("handles async effects", async () => {
    const effect = Effect.promise(() => Promise.resolve("async-value"));
    const result = await runServerAction(effect);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("async-value");
    }
  });

  it("handles defects gracefully", async () => {
    const effect = Effect.die(new Error("unexpected defect"));
    const result = await runServerAction(effect);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ServerActionError);
      expect(result.error.message).toContain("unexpected defect");
    }
  });
});

describe("runServerActionOrThrow", () => {
  it("returns value for successful effects", async () => {
    const effect = Effect.succeed(42);
    const result = await runServerActionOrThrow(effect);
    expect(result).toBe(42);
  });

  it("returns string value", async () => {
    const effect = Effect.succeed("test-value");
    const result = await runServerActionOrThrow(effect);
    expect(result).toBe("test-value");
  });

  it("returns object value", async () => {
    const data = { id: 1, name: "test" };
    const effect = Effect.succeed(data);
    const result = await runServerActionOrThrow(effect);
    expect(result).toEqual(data);
  });

  it("throws for failed effects", async () => {
    const effect = Effect.fail(new Error("boom"));
    await expect(runServerActionOrThrow(effect)).rejects.toThrow();
  });

  it("throws with error message", async () => {
    const effect = Effect.fail(new Error("specific error"));
    await expect(runServerActionOrThrow(effect)).rejects.toThrow("specific error");
  });

  it("works with custom runtime", async () => {
    class TestService extends Effect.Service<TestService>()("TestService", {
      effect: Effect.succeed({
        _tag: "TestService",
        getValue: () => "runtime-value",
      }),
    }) {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      getValue: () => "runtime-value",
    });
    const runtime = ManagedRuntime.make(layer);

    const effect = Effect.gen(function* () {
      const service = yield* TestService;
      return service.getValue();
    });

    const result = await runServerActionOrThrow(effect, { runtime });
    expect(result).toBe("runtime-value");

    await runtime.dispose();
  });

  it("throws for defects", async () => {
    const effect = Effect.die(new Error("fatal error"));
    await expect(runServerActionOrThrow(effect)).rejects.toThrow();
  });
});
