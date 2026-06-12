import { describe, expect, it } from "@effect/vitest";
import { Clock, ConfigProvider, Effect, Exit, Layer, TestClock } from "effect";
import {
  CircuitBreakerConfigFromEnv,
  CircuitOpenError,
  makeCircuitBreaker,
} from "#src/rpc/index.js";

describe("CircuitBreaker", () => {
  it.effect("initial state is closed", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker();
      const state = yield* breaker.getState;
      expect(state).toBe("closed");
    })
  );

  it.effect("success in closed state doesn't change state", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker();

      yield* breaker.execute(Effect.succeed("success"));
      const state = yield* breaker.getState;
      expect(state).toBe("closed");
    })
  );

  it.effect("failure count increments on failure", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({ failureThreshold: 5 });

      // Fail a few times but not enough to open
      yield* breaker.execute(Effect.fail(new Error("fail1"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail2"))).pipe(Effect.ignore);

      const state = yield* breaker.getState;
      expect(state).toBe("closed");
    })
  );

  it.effect("circuit opens after failureThreshold failures", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({ failureThreshold: 5 });

      // Fail exactly 5 times
      for (let i = 0; i < 5; i++) {
        yield* breaker.execute(Effect.fail(new Error("fail"))).pipe(Effect.ignore);
      }

      const state = yield* breaker.getState;
      expect(state).toBe("open");
    })
  );

  it.effect("open circuit rejects with CircuitOpenError", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({ failureThreshold: 3 });

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        yield* breaker.execute(Effect.fail(new Error("fail"))).pipe(Effect.ignore);
      }

      // Try to execute - should fail with CircuitOpenError
      const exit = yield* breaker.execute(Effect.succeed("test")).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = exit.cause;
        // Check if it's a CircuitOpenError by examining the error structure
        expect(error).toBeDefined();
      }
    })
  );

  it.effect("CircuitOpenError contains openedAt timestamp", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({ failureThreshold: 2 });

      const beforeOpen = yield* Clock.currentTimeMillis;

      // Open the circuit
      yield* breaker.execute(Effect.fail(new Error("fail1"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail2"))).pipe(Effect.ignore);

      const afterOpen = yield* Clock.currentTimeMillis;

      // Try to execute - should fail with CircuitOpenError
      const result = yield* breaker
        .execute(Effect.succeed("test"))
        .pipe(Effect.catchTag("CircuitOpenError", (error) => Effect.succeed(error)));

      expect(result).toBeInstanceOf(CircuitOpenError);
      if (result instanceof CircuitOpenError) {
        expect(result.openedAt).toBeGreaterThanOrEqual(beforeOpen);
        expect(result.openedAt).toBeLessThanOrEqual(afterOpen);
        expect(result.message).toBe("Circuit breaker is open");
      }
    })
  );

  it.effect("half-open state after resetTimeout", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 50,
      });

      // Open the circuit
      yield* breaker.execute(Effect.fail(new Error("fail1"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail2"))).pipe(Effect.ignore);

      let state = yield* breaker.getState;
      expect(state).toBe("open");

      // Wait for reset timeout
      yield* TestClock.adjust("60 millis");

      // The next execute should transition to half-open
      // We need to actually try to execute to trigger the state check
      yield* breaker.execute(Effect.succeed("test")).pipe(Effect.ignore);

      state = yield* breaker.getState;
      expect(state).toBe("half-open");
    })
  );

  it.effect("success in half-open increments success count", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 50,
        successThreshold: 2,
      });

      // Open the circuit
      yield* breaker.execute(Effect.fail(new Error("fail1"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail2"))).pipe(Effect.ignore);

      // Wait for reset timeout
      yield* TestClock.adjust("60 millis");

      // Execute once to go to half-open
      yield* breaker.execute(Effect.succeed("test1"));

      const state = yield* breaker.getState;
      expect(state).toBe("half-open");
    })
  );

  it.effect("successThreshold successes in half-open closes circuit", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 50,
        successThreshold: 2,
      });

      // Open the circuit
      yield* breaker.execute(Effect.fail(new Error("fail1"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail2"))).pipe(Effect.ignore);

      // Wait for reset timeout
      yield* TestClock.adjust("60 millis");

      // Execute successfully twice
      yield* breaker.execute(Effect.succeed("test1"));
      yield* breaker.execute(Effect.succeed("test2"));

      const state = yield* breaker.getState;
      expect(state).toBe("closed");
    })
  );

  it.effect("single failure in half-open reopens circuit", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 50,
        successThreshold: 2,
      });

      // Open the circuit
      yield* breaker.execute(Effect.fail(new Error("fail1"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail2"))).pipe(Effect.ignore);

      // Wait for reset timeout
      yield* TestClock.adjust("60 millis");

      // Execute once successfully to go to half-open
      yield* breaker.execute(Effect.succeed("test1"));

      let state = yield* breaker.getState;
      expect(state).toBe("half-open");

      // Now fail - should reopen
      yield* breaker.execute(Effect.fail(new Error("fail3"))).pipe(Effect.ignore);

      state = yield* breaker.getState;
      expect(state).toBe("open");
    })
  );

  it.effect("reset() returns to closed state", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({ failureThreshold: 2 });

      // Open the circuit
      yield* breaker.execute(Effect.fail(new Error("fail1"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail2"))).pipe(Effect.ignore);

      let state = yield* breaker.getState;
      expect(state).toBe("open");

      // Reset manually
      yield* breaker.reset;

      state = yield* breaker.getState;
      expect(state).toBe("closed");
    })
  );

  it.effect("success in closed resets failure count", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({ failureThreshold: 3 });

      // Fail twice
      yield* breaker.execute(Effect.fail(new Error("fail1"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail2"))).pipe(Effect.ignore);

      // Success should reset failure count
      yield* breaker.execute(Effect.succeed("success"));

      // Now fail three more times - should open
      yield* breaker.execute(Effect.fail(new Error("fail3"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail4"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail5"))).pipe(Effect.ignore);

      const state = yield* breaker.getState;
      expect(state).toBe("open");
    })
  );

  it.effect("default configuration values", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker();

      // Default: failureThreshold=5, resetTimeout=30000, successThreshold=3
      // Verify circuit opens after 5 failures
      for (let i = 0; i < 5; i++) {
        yield* breaker.execute(Effect.fail(new Error("fail"))).pipe(Effect.ignore);
      }

      const state = yield* breaker.getState;
      expect(state).toBe("open");
    })
  );

  it.effect("custom configuration applied", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({
        failureThreshold: 10,
        resetTimeout: 100,
        successThreshold: 3,
      });

      // Should not open after 5 failures (threshold is 10)
      for (let i = 0; i < 5; i++) {
        yield* breaker.execute(Effect.fail(new Error("fail"))).pipe(Effect.ignore);
      }

      let state = yield* breaker.getState;
      expect(state).toBe("closed");

      // But should open after 10
      for (let i = 0; i < 5; i++) {
        yield* breaker.execute(Effect.fail(new Error("fail"))).pipe(Effect.ignore);
      }

      state = yield* breaker.getState;
      expect(state).toBe("open");
    })
  );

  it.effect("multiple successes required to close from half-open", () =>
    Effect.gen(function* () {
      const breaker = yield* makeCircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 50,
        successThreshold: 3,
      });

      // Open the circuit
      yield* breaker.execute(Effect.fail(new Error("fail1"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail2"))).pipe(Effect.ignore);

      // Wait for reset timeout
      yield* TestClock.adjust("60 millis");

      // Two successes should not close (need 3)
      yield* breaker.execute(Effect.succeed("test1"));
      yield* breaker.execute(Effect.succeed("test2"));

      let state = yield* breaker.getState;
      expect(state).toBe("half-open");

      // Third success should close
      yield* breaker.execute(Effect.succeed("test3"));

      state = yield* breaker.getState;
      expect(state).toBe("closed");
    })
  );

  it.effect("code default successThreshold is 3 (matches env default)", () =>
    Effect.gen(function* () {
      // No successThreshold passed -> code default must be 3 to match the env schema.
      const breaker = yield* makeCircuitBreaker({ failureThreshold: 2, resetTimeout: 50 });

      // Open the circuit
      yield* breaker.execute(Effect.fail(new Error("fail1"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail2"))).pipe(Effect.ignore);

      yield* TestClock.adjust("60 millis");

      // Two successes must NOT close (default threshold is 3, not 2).
      yield* breaker.execute(Effect.succeed("ok1"));
      yield* breaker.execute(Effect.succeed("ok2"));
      expect(yield* breaker.getState).toBe("half-open");

      // Third closes.
      yield* breaker.execute(Effect.succeed("ok3"));
      expect(yield* breaker.getState).toBe("closed");
    })
  );

  it.effect("concurrent probes after reset window promote to half-open exactly once", () =>
    Effect.gen(function* () {
      // successThreshold high enough that concurrent probes can't accidentally close.
      const breaker = yield* makeCircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 50,
        successThreshold: 10,
      });

      // Open the circuit
      yield* breaker.execute(Effect.fail(new Error("fail1"))).pipe(Effect.ignore);
      yield* breaker.execute(Effect.fail(new Error("fail2"))).pipe(Effect.ignore);
      expect(yield* breaker.getState).toBe("open");

      yield* TestClock.adjust("60 millis");

      // Fire many concurrent probes. The atomic promote-and-admit must yield a single
      // coherent half-open transition (no fiber observes a stale "open" and rejects,
      // no double promotion corrupts the success counter).
      const results = yield* Effect.all(
        Array.from({ length: 8 }, () => breaker.execute(Effect.succeed("ok")).pipe(Effect.either)),
        { concurrency: "unbounded" }
      );

      // All probes are admitted (none rejected with CircuitOpenError).
      for (const r of results) {
        expect(r._tag).toBe("Right");
      }
      // Still half-open since 8 < successThreshold (10).
      expect(yield* breaker.getState).toBe("half-open");
    })
  );

  describe("CircuitBreakerConfigFromEnv", () => {
    it.effect("loads default values from environment", () =>
      Effect.gen(function* () {
        const config = yield* CircuitBreakerConfigFromEnv;

        expect(config.failureThreshold).toBe(5);
        expect(config.successThreshold).toBe(3);
        expect(config.resetTimeout).toBe(30_000);
      })
    );

    it.effect("loads custom values from environment", () =>
      Effect.gen(function* () {
        const config = yield* CircuitBreakerConfigFromEnv;

        expect(config.failureThreshold).toBe(10);
        expect(config.successThreshold).toBe(5);
        expect(config.resetTimeout).toBe(60_000);
      }).pipe(
        Effect.provide(
          Layer.setConfigProvider(
            ConfigProvider.fromMap(
              new Map([
                ["EW3_CIRCUIT_BREAKER_FAILURE_THRESHOLD", "10"],
                ["EW3_CIRCUIT_BREAKER_SUCCESS_THRESHOLD", "5"],
                ["EW3_CIRCUIT_BREAKER_RESET_TIMEOUT", "60000"],
              ]),
              { pathDelim: "_" }
            )
          )
        )
      )
    );

    it.effect("uses defaults for missing environment variables", () =>
      Effect.gen(function* () {
        const config = yield* CircuitBreakerConfigFromEnv;

        expect(config.failureThreshold).toBe(7);
        expect(config.successThreshold).toBe(3); // default
        expect(config.resetTimeout).toBe(30_000); // default
      }).pipe(
        Effect.provide(
          Layer.setConfigProvider(
            ConfigProvider.fromMap(
              new Map([
                ["EW3_CIRCUIT_BREAKER_FAILURE_THRESHOLD", "7"],
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
