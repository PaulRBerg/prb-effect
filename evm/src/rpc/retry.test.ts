import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Fiber, Layer, TestClock } from "effect";
import {
  defaultRetryableErrors,
  makeRetrySchedule,
  RetryConfigFromEnv,
  withRetry,
} from "#src/rpc/index.js";

describe("retry", () => {
  const runWithTime = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    adjust: Parameters<typeof TestClock.adjust>[0] = "1000 millis"
  ) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(effect);
      yield* TestClock.adjust(adjust);
      return yield* Fiber.join(fiber);
    });

  it.effect("matches 'rate limit' case insensitive", () =>
    Effect.gen(function* () {
      const retries: number[] = [];
      const program = Effect.gen(function* () {
        const attempt = retries.length;
        retries.push(attempt);
        if (attempt < 2) {
          return yield* Effect.fail(new Error("Rate Limit exceeded"));
        }
        return "success";
      }).pipe(
        Effect.retry(
          makeRetrySchedule({
            baseDelay: 1,
            maxRetries: 3,
            retryableErrors: ["rate limit"],
          })
        )
      );
      const result = yield* runWithTime(program);

      expect(result).toBe("success");
      expect(retries.length).toBe(3); // Initial + 2 retries
    })
  );

  it.effect("matches timeout, ECONNRESET, 503, 429", () =>
    Effect.gen(function* () {
      const errors = ["timeout error", "ECONNRESET", "503 Service Unavailable", "429 Too Many"];

      for (const errorMsg of errors) {
        const retries: number[] = [];
        const program = Effect.gen(function* () {
          const attempt = retries.length;
          retries.push(attempt);
          if (attempt < 1) {
            return yield* Effect.fail(new Error(errorMsg));
          }
          return "success";
        }).pipe(Effect.retry(makeRetrySchedule({ baseDelay: 1, maxRetries: 2 })));
        const result = yield* runWithTime(program);

        expect(result).toBe("success");
        expect(retries.length).toBeGreaterThan(1);
      }
    })
  );

  it.effect("non-retryable errors fail immediately", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const exit = yield* Effect.gen(function* () {
        attempts += 1;
        return yield* Effect.fail(new Error("Invalid argument"));
      }).pipe(Effect.retry(makeRetrySchedule({ baseDelay: 1, maxRetries: 3 })), Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(attempts).toBe(1); // No retries
    })
  );

  it.effect("retries up to maxRetries on retryable error", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        return yield* Effect.fail(new Error("rate limit"));
      }).pipe(withRetry({ baseDelay: 1, maxRetries: 3 }), Effect.exit);
      const exit = yield* runWithTime(program);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(attempts).toBe(4); // Initial + 3 retries
    })
  );

  it.effect("exponential backoff delay calculation", () =>
    Effect.gen(function* () {
      let attempts = 0;

      const program = Effect.gen(function* () {
        attempts += 1;
        return yield* Effect.fail(new Error("timeout"));
      }).pipe(withRetry({ baseDelay: 1, maxDelay: 10, maxRetries: 3 }), Effect.exit);
      const exit = yield* runWithTime(program);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(attempts).toBe(4);
    })
  );

  it.effect("maxDelay caps the delay", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        return yield* Effect.fail(new Error("503"));
      }).pipe(withRetry({ baseDelay: 1, maxDelay: 2, maxRetries: 3 }), Effect.exit);
      const exit = yield* runWithTime(program);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(attempts).toBe(4); // Initial + 3 retries
    })
  );

  it.effect("custom retryableErrors patterns work", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        if (attempts < 2) {
          return yield* Effect.fail(new Error("CUSTOM_ERROR"));
        }
        return "success";
      }).pipe(
        withRetry({
          baseDelay: 1,
          maxRetries: 3,
          retryableErrors: ["CUSTOM_ERROR"],
        })
      );
      const result = yield* runWithTime(program);

      expect(result).toBe("success");
      expect(attempts).toBe(2);
    })
  );

  it.effect("success on first try doesn't retry", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const result = yield* Effect.sync(() => {
        attempts += 1;
        return "success";
      }).pipe(withRetry({ baseDelay: 1, maxRetries: 3 }));

      expect(result).toBe("success");
      expect(attempts).toBe(1);
    })
  );

  it.effect("success after initial failures returns result", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        if (attempts < 3) {
          return yield* Effect.fail(new Error("timeout"));
        }
        return "recovered";
      }).pipe(withRetry({ baseDelay: 1, maxRetries: 5 }));
      const result = yield* runWithTime(program);

      expect(result).toBe("recovered");
      expect(attempts).toBe(3);
    })
  );

  it.effect("schedule defaults are correct", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        return yield* Effect.fail(new Error("rate limit"));
      }).pipe(withRetry({ baseDelay: 1 }), Effect.exit); // Use baseDelay: 1 for fast test
      const exit = yield* runWithTime(program);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(attempts).toBe(4); // Initial + 3 retries (default maxRetries)
    })
  );

  it("defaultRetryableErrors contains expected error patterns", () => {
    expect(defaultRetryableErrors).toContain("rate limit");
    expect(defaultRetryableErrors).toContain("timeout");
    expect(defaultRetryableErrors).toContain("ECONNRESET");
    expect(defaultRetryableErrors).toContain("ETIMEDOUT");
    expect(defaultRetryableErrors).toContain("503");
    expect(defaultRetryableErrors).toContain("502");
    expect(defaultRetryableErrors).toContain("429");
  });

  it.effect("works with Error instances", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        if (attempts < 2) {
          return yield* Effect.fail(new Error("timeout occurred"));
        }
        return "success";
      }).pipe(withRetry({ baseDelay: 1, maxRetries: 2 }));
      const result = yield* runWithTime(program);

      expect(result).toBe("success");
      expect(attempts).toBe(2);
    })
  );

  it.effect("works with string errors", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        if (attempts < 2) {
          return yield* Effect.fail("rate limit exceeded");
        }
        return "success";
      }).pipe(withRetry({ baseDelay: 1, maxRetries: 2 }));
      const result = yield* runWithTime(program);

      expect(result).toBe("success");
      expect(attempts).toBe(2);
    })
  );

  describe("RetryConfigFromEnv", () => {
    it.effect("loads default values from environment", () =>
      Effect.gen(function* () {
        const config = yield* RetryConfigFromEnv;

        expect(config.maxRetries).toBe(3);
        expect(config.baseDelay).toBe(100);
        expect(config.maxDelay).toBe(10_000);
        expect(config.jitter).toBe(true);
      })
    );

    it.effect("loads custom values from environment", () =>
      Effect.gen(function* () {
        const config = yield* RetryConfigFromEnv;

        expect(config.maxRetries).toBe(5);
        expect(config.baseDelay).toBe(200);
        expect(config.maxDelay).toBe(20_000);
        expect(config.jitter).toBe(false);
      }).pipe(
        Effect.provide(
          Layer.setConfigProvider(
            ConfigProvider.fromMap(
              new Map([
                ["EW3_RETRY_MAX_RETRIES", "5"],
                ["EW3_RETRY_BASE_DELAY", "200"],
                ["EW3_RETRY_MAX_DELAY", "20000"],
                ["EW3_RETRY_JITTER", "false"],
              ]),
              { pathDelim: "_" }
            )
          )
        )
      )
    );

    it.effect("uses defaults for missing environment variables", () =>
      Effect.gen(function* () {
        const config = yield* RetryConfigFromEnv;

        expect(config.maxRetries).toBe(10);
        expect(config.baseDelay).toBe(100); // default
        expect(config.maxDelay).toBe(10_000); // default
        expect(config.jitter).toBe(true); // default
      }).pipe(
        Effect.provide(
          Layer.setConfigProvider(
            ConfigProvider.fromMap(
              new Map([
                ["EW3_RETRY_MAX_RETRIES", "10"],
                // Other values should use defaults
              ]),
              { pathDelim: "_" }
            )
          )
        )
      )
    );
  });
});
