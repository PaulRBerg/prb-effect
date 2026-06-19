import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  RateLimitExceeded,
  RateLimitMiddleware,
  RateLimitStoreError,
  makeInMemoryRateLimitStore,
  makeRateLimitMiddleware,
  rateLimitKey,
} = await import("./index.js");

describe("rate-limit middleware", () => {
  it.effect("allows requests within the limit", () => {
    const layer = makeRateLimitMiddleware({
      key: rateLimitKey.path(),
      limit: 2,
      store: makeInMemoryRateLimitStore(),
      window: "1 minute",
    });

    return Effect.gen(function* () {
      const middleware = yield* RateLimitMiddleware;
      const request = new Request("https://example.com/api/items");

      yield* middleware({ props: [request] });
      yield* middleware({ props: [request] });
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects requests over the limit with metadata", () =>
    Effect.gen(function* () {
      const layer = makeRateLimitMiddleware({
        key: rateLimitKey.path(),
        limit: 1,
        store: makeInMemoryRateLimitStore(),
        window: "1 minute",
      });
      const program = Effect.gen(function* () {
        const middleware = yield* RateLimitMiddleware;
        const request = new Request("https://example.com/api/items");
        yield* middleware({ props: [request] });
        yield* middleware({ props: [request] });
      }).pipe(Effect.provide(layer), Effect.either);

      const result = yield* program;

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(RateLimitExceeded);
        expect(result.left._tag).toBe("RateLimitExceeded");
        if (result.left._tag === "RateLimitExceeded") {
          expect(result.left.limit).toBe(1);
          expect(result.left.remaining).toBe(0);
          expect(result.left.resetAt).toBeGreaterThan(0);
        }
      }
    })
  );

  it.effect("normalizes invalid numeric limits to one", () =>
    Effect.gen(function* () {
      const layer = makeRateLimitMiddleware({
        key: rateLimitKey.path(),
        limit: Number.NaN,
        store: makeInMemoryRateLimitStore(),
        window: "1 minute",
      });
      const program = Effect.gen(function* () {
        const middleware = yield* RateLimitMiddleware;
        const request = new Request("https://example.com/api/items");
        yield* middleware({ props: [request] });
        yield* middleware({ props: [request] });
      }).pipe(Effect.provide(layer), Effect.either);

      const result = yield* program;

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(RateLimitExceeded);
        if (result.left._tag === "RateLimitExceeded") {
          expect(result.left.limit).toBe(1);
        }
      }
    })
  );

  it.effect("derives keys from route handler props", () =>
    Effect.gen(function* () {
      const keys: string[] = [];
      const store = {
        increment: (key: string, _windowSeconds: number, limit: number) =>
          Effect.sync(() => {
            keys.push(key);
            return { count: 1, limit, remaining: limit - 1, resetAt: 1000 };
          }),
      };
      const layer = makeRateLimitMiddleware({
        key: rateLimitKey.combine(
          rateLimitKey.method(),
          rateLimitKey.path(),
          rateLimitKey.header("x-plan"),
          rateLimitKey.ip()
        ),
        limit: 5,
        store,
        window: "1 minute",
      });
      const request = new Request("https://example.com/api/items?tab=all", {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.10, 70.41.3.18",
          "x-plan": "pro",
        },
      });

      yield* Effect.gen(function* () {
        const middleware = yield* RateLimitMiddleware;
        yield* middleware({ props: [request] });
      }).pipe(Effect.provide(layer));

      expect(keys).toEqual(["method:POST|path:/api/items|header:x-plan:pro|ip:203.0.113.10"]);
    })
  );

  it.effect("fails open on store errors when configured", () =>
    Effect.gen(function* () {
      const layer = makeRateLimitMiddleware({
        failurePolicy: "fail-open",
        limit: 1,
        window: "1 minute",
        store: {
          increment: () => Effect.fail("down"),
        },
      });

      yield* Effect.gen(function* () {
        const middleware = yield* RateLimitMiddleware;
        yield* middleware({ props: [new Request("https://example.com/api")] });
      }).pipe(Effect.provide(layer));
    })
  );

  it.effect("fails closed on store errors by default", () =>
    Effect.gen(function* () {
      const layer = makeRateLimitMiddleware({
        limit: 1,
        window: "1 minute",
        store: {
          increment: () => Effect.fail("down"),
        },
      });
      const program = Effect.gen(function* () {
        const middleware = yield* RateLimitMiddleware;
        yield* middleware({ props: [new Request("https://example.com/api")] });
      }).pipe(Effect.provide(layer), Effect.either);

      const result = yield* program;

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(RateLimitStoreError);
      }
    })
  );
});
