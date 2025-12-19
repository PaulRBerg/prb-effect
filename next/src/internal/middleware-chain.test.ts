import { describe, expect, it } from "@effect/vitest";
import { Context, Effect } from "effect";
import type {
  NextMiddleware,
  NextMiddlewareWrap,
  TagClassAnyWithProps,
} from "../middleware/index.js";
import { createMiddlewareChain } from "./middleware-chain.js";

// Test service for provider middleware
class TestService extends Context.Tag("TestService")<TestService, { readonly value: string }>() {}

describe("createMiddlewareChain", () => {
  it("executes middleware in order (left-to-right) before base", async () => {
    const executionOrder: string[] = [];

    // Create middleware tags
    const tag1 = {
      key: "middleware1",
      provides: undefined,
      wrap: false,
    } as TagClassAnyWithProps;

    const tag2 = {
      key: "middleware2",
      provides: undefined,
      wrap: false,
    } as TagClassAnyWithProps;

    // Middleware implementations
    const middleware1: NextMiddleware<void, never> = () =>
      Effect.sync(() => {
        executionOrder.push("middleware1");
      });

    const middleware2: NextMiddleware<void, never> = () =>
      Effect.sync(() => {
        executionOrder.push("middleware2");
      });

    const resolve = (tag: TagClassAnyWithProps) => {
      if (tag.key === "middleware1") {
        return middleware1;
      }
      if (tag.key === "middleware2") {
        return middleware2;
      }
      return middleware1;
    };

    const base = Effect.sync(() => {
      executionOrder.push("base");
      return "result";
    });

    const chain = createMiddlewareChain([tag1, tag2], resolve, base, {
      props: {},
    });
    const result = await Effect.runPromise(chain);

    expect(result).toBe("result");
    expect(executionOrder).toEqual(["middleware1", "middleware2", "base"]);
  });

  it("short-circuits on middleware failure (base not executed)", async () => {
    const executionOrder: string[] = [];

    const tag1 = {
      key: "middleware1",
      provides: undefined,
      wrap: false,
    } as TagClassAnyWithProps;

    const tag2 = {
      key: "middleware2",
      provides: undefined,
      wrap: false,
    } as TagClassAnyWithProps;

    const middleware1: NextMiddleware<void, never> = () =>
      Effect.sync(() => {
        executionOrder.push("middleware1");
      });

    const middleware2: NextMiddleware<void, string> = () =>
      Effect.gen(function* () {
        executionOrder.push("middleware2");
        yield* Effect.fail("middleware2 failed");
      });

    const resolve = (tag: TagClassAnyWithProps) => {
      if (tag.key === "middleware1") {
        return middleware1;
      }
      if (tag.key === "middleware2") {
        return middleware2;
      }
      return middleware1;
    };

    const base = Effect.sync(() => {
      executionOrder.push("base");
      return "result";
    });

    const chain = createMiddlewareChain([tag1, tag2], resolve, base, {
      props: {},
    });
    const result = await Effect.runPromise(Effect.either(chain));

    expect(result._tag).toBe("Left");
    expect(executionOrder).toEqual(["middleware1", "middleware2"]);
  });

  it("provides middleware supplies service to handler", async () => {
    const tag = {
      key: "provider",
      provides: TestService,
      wrap: false,
    } as unknown as TagClassAnyWithProps;

    const middleware: NextMiddleware<{ readonly value: string }, never> = () =>
      Effect.succeed({ value: "provided-value" });

    const resolve = () => middleware;

    const base: Effect.Effect<string, never, TestService> = Effect.gen(function* () {
      const service = yield* TestService;
      return service.value;
    });

    const chain = createMiddlewareChain([tag], resolve, base, { props: {} });
    // The middleware provides TestService, so the chain is runnable
    const result = await Effect.runPromise(chain as Effect.Effect<string, never, never>);

    expect(result).toBe("provided-value");
  });

  it("wrap middleware encloses tail chain", async () => {
    const executionOrder: string[] = [];

    const tag = {
      key: "wrapper",
      provides: undefined,
      wrap: true,
    } as TagClassAnyWithProps;

    const middleware: NextMiddlewareWrap<never, never, never> = ({ next }) =>
      Effect.gen(function* () {
        executionOrder.push("before-wrap");
        const result = yield* next;
        executionOrder.push("after-wrap");
        return result;
      });

    const resolve = () => middleware;

    const base = Effect.sync(() => {
      executionOrder.push("base");
      return "result";
    });

    const chain = createMiddlewareChain([tag], resolve, base, { props: {} });
    const result = await Effect.runPromise(chain);

    expect(result).toBe("result");
    expect(executionOrder).toEqual(["before-wrap", "base", "after-wrap"]);
  });

  it("threads props to middleware", async () => {
    let capturedProps: unknown = null;

    const tag = {
      key: "middleware",
      provides: undefined,
      wrap: false,
    } as TagClassAnyWithProps;

    const middleware: NextMiddleware<void, never> = (options) =>
      Effect.sync(() => {
        capturedProps = options.props;
      });

    const resolve = () => middleware;

    const base = Effect.succeed("result");
    const props = { testProp: "test-value" };

    const chain = createMiddlewareChain([tag], resolve, base, { props });
    await Effect.runPromise(chain);

    expect(capturedProps).toEqual({ testProp: "test-value" });
  });

  it("handles multiple wrap middleware", async () => {
    const executionOrder: string[] = [];

    const tag1 = {
      key: "wrapper1",
      provides: undefined,
      wrap: true,
    } as TagClassAnyWithProps;

    const tag2 = {
      key: "wrapper2",
      provides: undefined,
      wrap: true,
    } as TagClassAnyWithProps;

    const middleware1: NextMiddlewareWrap<never, never, never> = ({ next }) =>
      Effect.gen(function* () {
        executionOrder.push("wrapper1-before");
        const result = yield* next;
        executionOrder.push("wrapper1-after");
        return result;
      });

    const middleware2: NextMiddlewareWrap<never, never, never> = ({ next }) =>
      Effect.gen(function* () {
        executionOrder.push("wrapper2-before");
        const result = yield* next;
        executionOrder.push("wrapper2-after");
        return result;
      });

    const resolve = (tag: TagClassAnyWithProps) => {
      if (tag.key === "wrapper1") {
        return middleware1;
      }
      if (tag.key === "wrapper2") {
        return middleware2;
      }
      return middleware1;
    };

    const base = Effect.sync(() => {
      executionOrder.push("base");
      return "result";
    });

    const chain = createMiddlewareChain([tag1, tag2], resolve, base, {
      props: {},
    });
    const result = await Effect.runPromise(chain);

    expect(result).toBe("result");
    expect(executionOrder).toEqual([
      "wrapper1-before",
      "wrapper2-before",
      "base",
      "wrapper2-after",
      "wrapper1-after",
    ]);
  });

  it("combines provides and wrap middleware", async () => {
    const executionOrder: string[] = [];

    const providerTag = {
      key: "provider",
      provides: TestService,
      wrap: false,
    } as unknown as TagClassAnyWithProps;

    const wrapperTag = {
      key: "wrapper",
      provides: undefined,
      wrap: true,
    } as TagClassAnyWithProps;

    const provider: NextMiddleware<{ readonly value: string }, never> = () =>
      Effect.sync(() => {
        executionOrder.push("provider");
        return { value: "service-value" };
      });

    const wrapper: NextMiddlewareWrap<never, never, never> = ({ next }) =>
      Effect.gen(function* () {
        executionOrder.push("wrapper-before");
        const result = yield* next;
        executionOrder.push("wrapper-after");
        return result;
      });

    const resolve = (tag: TagClassAnyWithProps) => {
      if (tag.key === "provider") {
        return provider;
      }
      if (tag.key === "wrapper") {
        return wrapper;
      }
      return provider;
    };

    const base: Effect.Effect<string, never, TestService> = Effect.gen(function* () {
      executionOrder.push("base");
      const service = yield* TestService;
      return service.value;
    });

    const chain = createMiddlewareChain([wrapperTag, providerTag], resolve, base, { props: {} });
    // The middleware chain provides TestService, so the chain is runnable
    const result = await Effect.runPromise(chain as Effect.Effect<string, never, never>);

    expect(result).toBe("service-value");
    expect(executionOrder).toEqual(["wrapper-before", "provider", "base", "wrapper-after"]);
  });
});
