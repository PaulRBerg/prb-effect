import { describe, expect, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { vi } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

// Create stable AsyncLocalStorage instances at module level
const { AsyncLocalStorage } = await import("node:async_hooks");
const workAsyncStorage = new AsyncLocalStorage();
const workUnitAsyncStorage = new AsyncLocalStorage();

// Mock unstable_rethrow
const { unstable_rethrow, notFound, redirect, permanentRedirect } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("next-not-found");
  }),
  permanentRedirect: vi.fn((_url: string) => {
    throw new Error("next-permanent-redirect");
  }),
  redirect: vi.fn((_url: string) => {
    throw new Error("next-redirect");
  }),
  unstable_rethrow: vi.fn((error: unknown) => {
    if (error instanceof Error && "digest" in error) throw error;
  }),
}));

vi.mock("next/navigation.js", () => ({
  unstable_rethrow,
  notFound,
  redirect,
  permanentRedirect,
}));

vi.mock("next/dist/server/app-render/work-async-storage.external.js", () => ({
  workAsyncStorage,
}));

vi.mock("next/dist/server/app-render/work-unit-async-storage.external.js", () => ({
  workUnitAsyncStorage,
}));

// Import after mocks
const { executeWithRuntimeExit, executeWithRuntime } = await import("./executor.js");
const { ContextWrapperService } = await import("./async-context.js");
const { NotFoundError, RedirectError } = await import("../navigation/index.js");

describe("executeWithRuntimeExit", () => {
  it("provides ContextWrapperService so effect can use it", async () => {
    const effect = Effect.gen(function* () {
      const wrapper = yield* ContextWrapperService;
      // Verify we received a context wrapper function
      expect(typeof wrapper).toBe("function");
      return "success";
    });

    const result = await executeWithRuntimeExit(undefined, effect);
    expect(Exit.isSuccess(result)).toBe(true);
  });

  it("returns Exit.success for successful effects", async () => {
    const effect = Effect.gen(function* () {
      yield* ContextWrapperService;
      return 42;
    });

    const result = await executeWithRuntimeExit(undefined, effect);

    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) {
      expect(result.value).toBe(42);
    }
  });

  it("returns Exit.failure for failed effects", async () => {
    const effect = Effect.gen(function* () {
      yield* ContextWrapperService;
      return yield* Effect.fail(new Error("test error"));
    });

    const result = await executeWithRuntimeExit(undefined, effect);

    expect(Exit.isFailure(result)).toBe(true);
  });

  it("does not throw on failure", async () => {
    const effect = Effect.gen(function* () {
      yield* ContextWrapperService;
      return yield* Effect.fail(new Error("should not throw"));
    });

    // Should not throw, just return Exit.failure
    const result = await executeWithRuntimeExit(undefined, effect);
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("works with custom runtime", async () => {
    class TestService extends Context.Service<
      TestService,
      { readonly _tag: string; readonly getValue: () => string }
    >()("TestService") {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      getValue: () => "custom",
    });
    const runtime = ManagedRuntime.make(layer);

    const effect = Effect.gen(function* () {
      yield* ContextWrapperService;
      const service = yield* TestService;
      return service.getValue();
    });

    const result = await executeWithRuntimeExit(runtime, effect);

    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) {
      expect(result.value).toBe("custom");
    }

    await runtime.dispose();
  });
});

describe("executeWithRuntime", () => {
  it("returns value for successful effects", async () => {
    const effect = Effect.gen(function* () {
      yield* ContextWrapperService;
      return "success";
    });

    const result = await executeWithRuntime(undefined, effect);
    expect(result).toBe("success");
  });

  it("throws for failed effects", async () => {
    const effect = Effect.gen(function* () {
      yield* ContextWrapperService;
      return yield* Effect.fail(new Error("failure"));
    });

    await expect(executeWithRuntime(undefined, effect)).rejects.toThrow();
  });

  it("throws the first pretty error", async () => {
    const effect = Effect.gen(function* () {
      yield* ContextWrapperService;
      return yield* Effect.fail(new Error("pretty error message"));
    });

    await expect(executeWithRuntime(undefined, effect)).rejects.toThrow("pretty error message");
  });

  it("calls unstable_rethrow for single defect", async () => {
    unstable_rethrow.mockClear();

    const defect = new Error("defect");
    const effect = Effect.gen(function* () {
      yield* ContextWrapperService;
      return yield* Effect.die(defect);
    });

    await expect(executeWithRuntime(undefined, effect)).rejects.toThrow();
    expect(unstable_rethrow).toHaveBeenCalledWith(defect);
  });

  it("works with custom runtime", async () => {
    class TestService extends Context.Service<
      TestService,
      { readonly _tag: string; readonly getValue: () => string }
    >()("TestService") {}

    const layer = Layer.succeed(TestService, {
      _tag: "TestService",
      getValue: () => "runtime-value",
    });
    const runtime = ManagedRuntime.make(layer);

    const effect = Effect.gen(function* () {
      yield* ContextWrapperService;
      const service = yield* TestService;
      return service.getValue();
    });

    const result = await executeWithRuntime(runtime, effect);
    expect(result).toBe("runtime-value");

    await runtime.dispose();
  });
});

describe("navigation and Cause boundaries", () => {
  it("converts typed not-found errors even in mixed causes", async () => {
    const cause = Cause.fromReasons<InstanceType<typeof NotFoundError> | Error>([
      Cause.makeDieReason(new Error("ordinary defect")),
      Cause.makeFailReason(new Error("other failure")),
      Cause.makeFailReason(new NotFoundError({})),
      Cause.makeInterruptReason(),
    ]);
    await expect(executeWithRuntime(undefined, Effect.failCause(cause))).rejects.toThrow(
      "next-not-found"
    );
    expect(notFound).toHaveBeenCalled();
  });

  it.each(["temporary", "permanent"] as const)("converts typed %s redirects", async (type) => {
    const error = new RedirectError({ type, url: "/destination" });
    await expect(executeWithRuntime(undefined, Effect.fail(error))).rejects.toThrow(
      type === "permanent" ? "next-permanent-redirect" : "next-redirect"
    );
    expect(type === "permanent" ? permanentRedirect : redirect).toHaveBeenCalledWith(
      "/destination"
    );
  });

  it("rethrows native Next control flow among multiple defects", async () => {
    const navigation = Object.assign(new Error("native redirect"), {
      digest: "NEXT_REDIRECT;replace;/destination;307;",
    });
    const cause = Cause.fromReasons([
      Cause.makeDieReason(new Error("other defect")),
      Cause.makeDieReason(navigation),
    ]);
    await expect(executeWithRuntime(undefined, Effect.failCause(cause))).rejects.toBe(navigation);
  });

  it("keeps interruption-only exits and throws their boundary error", async () => {
    const exit = await executeWithRuntimeExit(undefined, Effect.interrupt);
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    await expect(executeWithRuntime(undefined, Effect.interrupt)).rejects.toBeInstanceOf(Error);
  });
});
