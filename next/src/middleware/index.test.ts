import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { vi } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

// Import after mocks
const { Tag, TypeId } = await import("./index.js");

describe("Tag()", () => {
  describe("default options", () => {
    it("key === id", () => {
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware") {}

      expect(TestMiddleware.key).toBe("TestMiddleware");
    });

    it("wrap === false", () => {
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware") {}

      expect(TestMiddleware.wrap).toBe(false);
    });

    it("failure defaults to Schema.Never", () => {
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware") {}

      expect(TestMiddleware.failure).toBe(Schema.Never);
    });

    it("catches defaults to Schema.Never", () => {
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware") {}

      expect(TestMiddleware.catches).toBe(Schema.Never);
    });

    it("returns defaults to Schema.Never", () => {
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware") {}

      expect(TestMiddleware.returns).toBe(Schema.Never);
    });

    it("provides === undefined by default", () => {
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware") {}

      expect(TestMiddleware.provides).toBe(undefined);
    });

    it("TypeId is present and equals exported TypeId", () => {
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware") {}

      expect((TestMiddleware as any)[TypeId]).toBe(TypeId);
    });

    it(".stack is a string (getter works)", () => {
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware") {}

      expect(typeof (TestMiddleware as any).stack).toBe("string");
      expect((TestMiddleware as any).stack.length).toBeGreaterThan(0);
    });
  });

  describe("options", () => {
    it("failure option is set when provided", () => {
      const failureSchema = Schema.String;
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware", {
        failure: failureSchema,
      }) {}

      expect(TestMiddleware.failure).toBe(failureSchema);
    });

    it("catches/returns apply when wrap: true", () => {
      const catchesSchema = Schema.String;
      const returnsSchema = Schema.Number;
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware", {
        catches: catchesSchema,
        returns: returnsSchema,
        wrap: true,
      }) {}

      expect(TestMiddleware.wrap).toBe(true);
      expect(TestMiddleware.catches).toBe(catchesSchema);
      expect(TestMiddleware.returns).toBe(returnsSchema);
    });

    it("catches/returns ignored when wrap: false", () => {
      const catchesSchema = Schema.String;
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware", {
        catches: catchesSchema as any, // Intentionally testing runtime behavior
        wrap: false,
      }) {}

      expect(TestMiddleware.wrap).toBe(false);
      expect(TestMiddleware.catches).toBe(Schema.Never);
      expect(TestMiddleware.returns).toBe(Schema.Never);
    });

    it("catches/returns ignored when wrap is omitted", () => {
      const catchesSchema = Schema.String;
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware", {
        catches: catchesSchema as any, // Intentionally testing runtime behavior
      }) {}

      expect(TestMiddleware.wrap).toBe(false);
      expect(TestMiddleware.catches).toBe(Schema.Never);
    });

    it("provides is stored by reference", () => {
      class ProvidedService extends Schema.Class<ProvidedService>("ProvidedService")({
        value: Schema.String,
      }) {}

      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware", {
        provides: ProvidedService as unknown as {
          readonly Identifier: typeof ProvidedService;
          readonly Service: ProvidedService;
        },
      }) {}

      expect(TestMiddleware.provides).toBe(ProvidedService);
    });
  });

  describe("Error.stackTraceLimit restoration", () => {
    it("Error.stackTraceLimit is restored after construction", () => {
      const originalLimit = (Error as any).stackTraceLimit;

      // Create a tag which internally modifies stackTraceLimit
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware") {}

      // Verify it was restored
      expect((Error as any).stackTraceLimit).toBe(originalLimit);
    });

    it("preserves custom stackTraceLimit", () => {
      const customLimit = 42;
      (Error as any).stackTraceLimit = customLimit;

      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware") {}

      expect((Error as any).stackTraceLimit).toBe(customLimit);
    });
  });

  describe(".of() helper", () => {
    it("should be available on wrap: true middleware", () => {
      class WrapMiddleware extends Tag<WrapMiddleware>()("WrapMiddleware", { wrap: true }) {}

      expect(typeof WrapMiddleware.of).toBe("function");
    });

    it("should be available on non-wrap middleware (implementation detail)", () => {
      class NonWrapMiddleware extends Tag<NonWrapMiddleware>()("NonWrapMiddleware") {}

      // Note: .of() is present at runtime, but TypeScript types prevent access
      expect(typeof (NonWrapMiddleware as any).of).toBe("function");
    });

    it("should correctly type middleware implementation", () => {
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware", { wrap: true }) {}

      // Should compile without casts
      const impl = TestMiddleware.of(({ next }) => next);

      expect(impl).toBeDefined();
      expect(typeof impl).toBe("function");
    });

    it("should accept middleware that transforms the next effect", () => {
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware", { wrap: true }) {}

      const impl = TestMiddleware.of(({ next }) =>
        Effect.gen(function* () {
          const result = yield* next;
          return result;
        })
      );

      expect(impl).toBeDefined();
      expect(typeof impl).toBe("function");
    });

    it("should work with Layer.succeed", async () => {
      const { Layer } = await import("effect");
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware", { wrap: true }) {}

      const impl = TestMiddleware.of(({ next }) => next);
      const layer = Layer.succeed(TestMiddleware, impl);

      expect(layer).toBeDefined();
    });

    it("should preserve middleware options structure", () => {
      class TestMiddleware extends Tag<TestMiddleware>()("TestMiddleware", { wrap: true }) {}

      let receivedOptions: any;
      const impl = TestMiddleware.of((options) => {
        receivedOptions = options;
        return options.next;
      });

      // Call the implementation with test data
      const testNext = Effect.succeed(42);
      const testProps = { test: "value" };
      impl({ next: testNext, props: testProps });

      expect(receivedOptions).toBeDefined();
      expect(receivedOptions.props).toBe(testProps);
      expect(receivedOptions.next).toBe(testNext);
    });
  });
});
