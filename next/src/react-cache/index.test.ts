import { afterEach, describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { vi } from "vitest";

// Mock server-only to prevent import errors
vi.mock("server-only", () => ({}));

// Mock React's cache with a WeakMap+Map implementation that preserves function identity
const resetFns: Array<() => void> = [];

vi.mock("react", () => {
  return {
    cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => {
      // Per-request scope: cleared between tests via afterEach
      let argCache = new Map<string, WeakMap<object, unknown>>();
      let primitiveCache = new Map<string, unknown>();

      const cached = (...args: unknown[]) => {
        // Separate the first arg (function ref) from the rest (primitive keys)
        const [fnRef, ...rest] = args;
        const restKey = JSON.stringify(rest);

        if (typeof fnRef === "function" || (typeof fnRef === "object" && fnRef !== null)) {
          if (!argCache.has(restKey)) {
            argCache.set(restKey, new WeakMap());
          }
          // biome-ignore lint/style/noNonNullAssertion: guaranteed by has-check above
          const wm = argCache.get(restKey)!;
          if (wm.has(fnRef as object)) {
            return wm.get(fnRef as object);
          }
          const result = fn(...args);
          wm.set(fnRef as object, result);
          return result;
        }
        // Fallback for primitive-only args
        const key = JSON.stringify(args);
        if (primitiveCache.has(key)) {
          return primitiveCache.get(key);
        }
        const result = fn(...args);
        primitiveCache.set(key, result);
        return result;
      };

      resetFns.push(() => {
        argCache = new Map();
        primitiveCache = new Map();
      });

      return cached as T;
    },
  };
});

// Import after mocks are set up
const { reactCache } = await import("./index.js");

afterEach(() => {
  for (const reset of resetFns) {
    reset();
  }
});

describe("reactCache", () => {
  describe("memoization", () => {
    it("memoizes by arguments — same args execute only once", async () => {
      let callCount = 0;
      const fn = reactCache((id: string) =>
        Effect.sync(() => {
          callCount += 1;
          return `user-${id}`;
        })
      );

      const result1 = await Effect.runPromise(fn("123"));
      const result2 = await Effect.runPromise(fn("123"));

      expect(result1).toBe("user-123");
      expect(result2).toBe("user-123");
      expect(callCount).toBe(1);
    });

    it("executes separately for different arguments", async () => {
      let callCount = 0;
      const fn = reactCache((id: string) =>
        Effect.sync(() => {
          callCount += 1;
          return `user-${id}`;
        })
      );

      const result1 = await Effect.runPromise(fn("abc"));
      const result2 = await Effect.runPromise(fn("def"));

      expect(result1).toBe("user-abc");
      expect(result2).toBe("user-def");
      expect(callCount).toBe(2);
    });

    it("context is ignored — first call wins", async () => {
      class Locale extends Context.Tag("Locale")<Locale, string>() {}

      const fn = reactCache((id: string) =>
        Effect.gen(function* () {
          const locale = yield* Locale;
          return `${locale}:${id}`;
        })
      );

      const enRuntime = ManagedRuntime.make(Layer.succeed(Locale, "en"));
      const frRuntime = ManagedRuntime.make(Layer.succeed(Locale, "fr"));

      const enResult = await enRuntime.runPromise(fn("item"));
      const frResult = await frRuntime.runPromise(fn("item"));

      // Both return "en:item" because the first call's runtime wins
      expect(enResult).toBe("en:item");
      expect(frResult).toBe("en:item");

      await enRuntime.dispose();
      await frRuntime.dispose();
    });

    it("works with zero-argument effects", async () => {
      let callCount = 0;
      const fn = reactCache(() =>
        Effect.sync(() => {
          callCount += 1;
          return "singleton";
        })
      );

      const result1 = await Effect.runPromise(fn());
      const result2 = await Effect.runPromise(fn());

      expect(result1).toBe("singleton");
      expect(result2).toBe("singleton");
      expect(callCount).toBe(1);
    });
  });

  describe("concurrent deduplication", () => {
    it("shares a single promise for concurrent calls with same args", async () => {
      let callCount = 0;
      const fn = reactCache((id: string) =>
        Effect.sync(() => {
          callCount += 1;
          return `user-${id}`;
        })
      );

      const [r1, r2] = await Promise.all([
        Effect.runPromise(fn("same")),
        Effect.runPromise(fn("same")),
      ]);

      expect(r1).toBe("user-same");
      expect(r2).toBe("user-same");
      expect(callCount).toBe(1);
    });
  });

  describe("error caching", () => {
    it("caches failures like successes", async () => {
      let callCount = 0;
      const fn = reactCache((id: string) =>
        Effect.gen(function* () {
          callCount += 1;
          return yield* Effect.fail(`not-found-${id}`);
        })
      );

      const exit1 = await Effect.runPromiseExit(fn("missing"));
      const exit2 = await Effect.runPromiseExit(fn("missing"));

      expect(exit1).toEqual(exit2);
      expect(callCount).toBe(1);
    });

    it("caches different errors for different arguments", async () => {
      const fn = reactCache((code: number) => Effect.fail({ _tag: "HttpError" as const, code }));

      const exit404 = await Effect.runPromiseExit(fn(404));
      const exit500 = await Effect.runPromiseExit(fn(500));

      expect(exit404).not.toEqual(exit500);
    });

    it("shares cached error for concurrent calls", async () => {
      let callCount = 0;
      const fn = reactCache((_id: string) =>
        Effect.gen(function* () {
          callCount += 1;
          return yield* Effect.fail("boom");
        })
      );

      const [exit1, exit2] = await Promise.all([
        Effect.runPromiseExit(fn("x")),
        Effect.runPromiseExit(fn("x")),
      ]);

      expect(exit1).toEqual(exit2);
      expect(callCount).toBe(1);
    });
  });

  describe("span preservation", () => {
    it("preserves spans through the cache", async () => {
      const fn = reactCache((id: string) =>
        Effect.succeed(`user-${id}`).pipe(Effect.withSpan("getUser"))
      );

      const result = await Effect.runPromise(fn("123").pipe(Effect.withSpan("outer")));

      expect(result).toBe("user-123");
    });
  });
});
