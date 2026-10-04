import { describe, expect, it } from "@effect/vitest";
import { Clock, Effect, Fiber } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { makeBackoffSchedule } from "./schedule.js";

describe("makeBackoffSchedule", () => {
  it.effect("preserves the first delay, exponential growth, cap, and retry count", () =>
    Effect.gen(function* () {
      const attempts: number[] = [];
      const program = Effect.gen(function* () {
        attempts.push(yield* Clock.currentTimeMillis);
        return yield* Effect.fail("retry");
      }).pipe(
        Effect.retry(
          makeBackoffSchedule({ baseDelay: 10, jitter: false, maxDelay: 25, maxRetries: 4 })
        ),
        Effect.result
      );

      const fiber = yield* Effect.forkChild(program);
      yield* TestClock.adjust("100 millis");
      yield* Fiber.join(fiber);

      expect(attempts).toEqual([0, 10, 30, 55, 80]);
    })
  );
});
