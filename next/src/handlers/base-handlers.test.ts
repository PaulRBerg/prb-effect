import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { vi } from "vitest";
import type * as MiddlewareTypes from "../middleware/index.js";

/**
 * Note: These tests verify the base handlers factory function that creates
 * pre-configured Layout, Page, and Route handlers.
 */

// Mock server-only
vi.mock("server-only", () => ({}));

// Import after mocks
const { createBaseHandlers } = await import("./base-handlers.js");
const Middleware = await import("../middleware/index.js");

describe("createBaseHandlers", () => {
  it("throws if neither layer nor runtime provided", () => {
    expect(() => createBaseHandlers("TestBase", {})).toThrow(
      "Either runtime or layer must be provided"
    );
  });

  it("with runtime: Layout, Page, Route all use same base", () => {
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

    const handlers = createBaseHandlers("TestBase", { runtime });

    expect(handlers.Layout._tag).toBe("TestBase");
    expect(handlers.Layout.key).toBe("effect-next/Next/TestBase");
    expect(handlers.Layout.runtime).toBe(runtime);

    expect(handlers.Page._tag).toBe("TestBase");
    expect(handlers.Page.key).toBe("effect-next/Next/TestBase");
    expect(handlers.Page.runtime).toBe(runtime);

    expect(handlers.Route._tag).toBe("TestBase");
    expect(handlers.Route.key).toBe("effect-next/Next/TestBase");
    expect(handlers.Route.runtime).toBe(runtime);

    // All three should be the same reference
    expect(handlers.Layout).toBe(handlers.Page);
    expect(handlers.Page).toBe(handlers.Route);
  });

  it("with layer: creates a runtime", async () => {
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

    const handlers = createBaseHandlers("TestBase", { layer });

    expect(handlers.Layout._tag).toBe("TestBase");
    expect(handlers.Layout.key).toBe("effect-next/Next/TestBase");
    expect(handlers.Layout.runtime).toBeDefined();

    expect(handlers.Page._tag).toBe("TestBase");
    expect(handlers.Page.runtime).toBeDefined();

    expect(handlers.Route._tag).toBe("TestBase");
    expect(handlers.Route.runtime).toBeDefined();

    // All three should be the same reference
    expect(handlers.Layout).toBe(handlers.Page);
    expect(handlers.Page).toBe(handlers.Route);

    // Clean up runtime
    if (handlers.Layout.runtime) {
      await handlers.Layout.runtime.dispose();
    }
  });

  it("base has _tag and key derived from provided tag", async () => {
    const layer = Layer.empty;

    const handlers = createBaseHandlers("MyCustomTag", { layer });

    expect(handlers.Layout._tag).toBe("MyCustomTag");
    expect(handlers.Layout.key).toBe("effect-next/Next/MyCustomTag");

    // Clean up
    if (handlers.Layout.runtime) {
      await handlers.Layout.runtime.dispose();
    }
  });

  it("supports distinct tags per handler", async () => {
    const layer = Layer.empty;

    const handlers = createBaseHandlers(
      { Layout: "LayoutTag", Page: "PageTag", Route: "RouteTag" },
      { layer }
    );

    expect(handlers.Layout._tag).toBe("LayoutTag");
    expect(handlers.Page._tag).toBe("PageTag");
    expect(handlers.Route._tag).toBe("RouteTag");

    if (handlers.Layout.runtime) {
      await handlers.Layout.runtime.dispose();
    }
  });

  it("applies middlewares when provided", async () => {
    class TestMiddleware extends Middleware.Tag<TestMiddleware>()("TestMiddleware") {}

    const layer = Layer.empty;
    const handlers = createBaseHandlers("TestBase", {
      layer,
      middlewares: [TestMiddleware as unknown as MiddlewareTypes.TagClassAny],
    });

    expect(handlers.Layout.middlewares).toHaveLength(1);
    expect(handlers.Layout.middlewares[0]).toBe(TestMiddleware);

    if (handlers.Layout.runtime) {
      await handlers.Layout.runtime.dispose();
    }
  });
});
