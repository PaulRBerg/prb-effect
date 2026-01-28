import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Schedule, TestClock } from "effect";
import { TransactionFailedError } from "@/src/core/index.js";
import { makeBackoffSchedule } from "@/src/internal/index.js";
import { isRetryableError } from "@/src/rpc/index.js";
import { receiptRetryablePatterns } from "./internal/receipt-retry.js";

/**
 * Tests for the receipt retry schedule logic.
 * Uses exported patterns from manager.ts to ensure test stays in sync with implementation.
 */
describe("receipt retry schedule", () => {
  // Use same patterns as production, but with minimal delays for testing
  const makeTestRetrySchedule = () =>
    makeBackoffSchedule({ baseDelay: 1, jitter: false, maxRetries: 3 }).pipe(
      Schedule.whileInput<TransactionFailedError>((error) => {
        if (error._tag === "TransactionFailedError" && error.cause) {
          return isRetryableError(error.cause, receiptRetryablePatterns);
        }
        return false;
      })
    );

  const runWithTime = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    adjust: Parameters<typeof TestClock.adjust>[0] = "10 seconds"
  ) =>
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(effect);
      yield* TestClock.adjust(adjust);
      return yield* Fiber.join(fiber);
    });

  it.effect("retries on transient RPC error (503)", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        if (attempts < 3) {
          return yield* Effect.fail(
            new TransactionFailedError({
              cause: new Error("503 Service Unavailable"),
              hash: "0x123",
              message: "Failed to get receipt",
            })
          );
        }
        return "success";
      }).pipe(Effect.retry(makeTestRetrySchedule()));

      const result = yield* runWithTime(program);

      expect(result).toBe("success");
      expect(attempts).toBe(3);
    })
  );

  it.effect("retries on 'transaction not found' error", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        if (attempts < 2) {
          return yield* Effect.fail(
            new TransactionFailedError({
              cause: new Error("transaction not found in mempool"),
              hash: "0x123",
              message: "Failed to get receipt",
            })
          );
        }
        return "success";
      }).pipe(Effect.retry(makeTestRetrySchedule()));

      const result = yield* runWithTime(program);

      expect(result).toBe("success");
      expect(attempts).toBe(2);
    })
  );

  it.effect("retries on rate limit error", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        if (attempts < 2) {
          return yield* Effect.fail(
            new TransactionFailedError({
              cause: new Error("rate limit exceeded"),
              hash: "0x123",
              message: "Failed to get receipt",
            })
          );
        }
        return "success";
      }).pipe(Effect.retry(makeTestRetrySchedule()));

      const result = yield* runWithTime(program);

      expect(result).toBe("success");
      expect(attempts).toBe(2);
    })
  );

  it.effect("does not retry non-retryable errors", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const exit = yield* Effect.gen(function* () {
        attempts += 1;
        return yield* Effect.fail(
          new TransactionFailedError({
            cause: new Error("execution reverted"),
            hash: "0x123",
            message: "Failed to get receipt",
          })
        );
      }).pipe(Effect.retry(makeTestRetrySchedule()), Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(attempts).toBe(1); // No retries
    })
  );

  it.effect("does not retry generic 'not found' errors (pattern tightened)", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const exit = yield* Effect.gen(function* () {
        attempts += 1;
        return yield* Effect.fail(
          new TransactionFailedError({
            cause: new Error("method not found"),
            hash: "0x123",
            message: "Failed to get receipt",
          })
        );
      }).pipe(Effect.retry(makeTestRetrySchedule()), Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(attempts).toBe(1); // No retries - "method not found" shouldn't match
    })
  );

  it.effect("does not retry when cause is undefined", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const exit = yield* Effect.gen(function* () {
        attempts += 1;
        return yield* Effect.fail(
          new TransactionFailedError({
            hash: "0x123",
            message: "Failed to get receipt",
          })
        );
      }).pipe(Effect.retry(makeTestRetrySchedule()), Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(attempts).toBe(1); // No retries
    })
  );

  it.effect("exhausts retries on persistent error", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const program = Effect.gen(function* () {
        attempts += 1;
        return yield* Effect.fail(
          new TransactionFailedError({
            cause: new Error("503 Service Unavailable"),
            hash: "0x123",
            message: "Failed to get receipt",
          })
        );
      }).pipe(Effect.retry(makeTestRetrySchedule()), Effect.exit);

      const exit = yield* runWithTime(program);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(attempts).toBe(4); // Initial + 3 retries
    })
  );
});
