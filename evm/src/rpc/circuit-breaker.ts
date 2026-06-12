import { Clock, Config, Effect, Ref, Schema } from "effect";
import { DEFAULT_MAX_DELAY } from "#src/constants/index.js";

export type CircuitState = "closed" | "open" | "half-open";

export type CircuitBreakerConfig = {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Time in milliseconds before attempting recovery (default: 30_000) */
  resetTimeout?: number;
  /** Number of successes needed to close from half-open (default: 2) */
  successThreshold?: number;
};

/**
 * Config-based circuit breaker configuration from environment variables.
 *
 * Environment variables (all optional, nested under `EW3_CIRCUIT_BREAKER_` prefix):
 * - `EW3_CIRCUIT_BREAKER_FAILURE_THRESHOLD`: Number of failures before opening circuit (default: 5)
 * - `EW3_CIRCUIT_BREAKER_SUCCESS_THRESHOLD`: Number of successes needed to close from half-open (default: 3)
 * - `EW3_CIRCUIT_BREAKER_RESET_TIMEOUT`: Time in ms before attempting recovery (default: 30_000)
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { CircuitBreakerConfigFromEnv } from "effect-evm/rpc";
 *
 * const program = Effect.gen(function* () {
 *   const config = yield* CircuitBreakerConfigFromEnv;
 *   // Use config for circuit breaker
 * });
 * ```
 */
export const CircuitBreakerConfigFromEnv = Config.all({
  failureThreshold: Config.number("FAILURE_THRESHOLD").pipe(Config.withDefault(5)),
  resetTimeout: Config.number("RESET_TIMEOUT").pipe(Config.withDefault(30_000)),
  successThreshold: Config.number("SUCCESS_THRESHOLD").pipe(Config.withDefault(3)),
}).pipe(Config.nested("EW3_CIRCUIT_BREAKER"));

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitOpenError extends Schema.TaggedError<CircuitOpenError>()("CircuitOpenError", {
  message: Schema.String,
  openedAt: Schema.Number,
}) {}

/**
 * Internal state tracking for circuit breaker
 */
type CircuitBreakerState = {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
};

/**
 * Circuit breaker service definition
 */
export type CircuitBreaker = {
  /** Execute an effect with circuit breaker protection */
  readonly execute: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | CircuitOpenError, R>;
  /** Get current circuit state */
  readonly getState: Effect.Effect<CircuitState>;
  /** Manually reset the circuit to closed state */
  readonly reset: Effect.Effect<void>;
};

/**
 * Create a circuit breaker instance
 * Uses Ref for thread-safe state management
 *
 * @param config - Circuit breaker configuration options
 * @returns Effect that creates a new CircuitBreaker
 */
export const makeCircuitBreaker = (
  config?: CircuitBreakerConfig
): Effect.Effect<CircuitBreaker> => {
  const {
    failureThreshold = 5,
    resetTimeout = DEFAULT_MAX_DELAY,
    successThreshold = 3,
  } = config ?? {};

  return Effect.gen(function* () {
    const stateRef = yield* Ref.make<CircuitBreakerState>({
      failures: 0,
      lastFailureTime: 0,
      state: "closed",
      successes: 0,
    });

    const recordSuccess = Effect.gen(function* () {
      yield* Ref.update(stateRef, (state) => {
        if (state.state === "half-open") {
          const newSuccesses = state.successes + 1;
          if (newSuccesses >= successThreshold) {
            // Close the circuit after enough successes
            return {
              failures: 0,
              lastFailureTime: 0,
              state: "closed" as const,
              successes: 0,
            };
          }
          return { ...state, successes: newSuccesses };
        }
        // Reset failure count on success in closed state
        return { ...state, failures: 0 };
      });
    });

    const recordFailure = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* Ref.update(stateRef, (state) => {
        const newFailures = state.failures + 1;

        if (state.state === "half-open") {
          // Failure in half-open state reopens the circuit
          return {
            failures: newFailures,
            lastFailureTime: now,
            state: "open" as const,
            successes: 0,
          };
        }

        if (state.state === "closed" && newFailures >= failureThreshold) {
          // Open the circuit after threshold failures
          return {
            failures: newFailures,
            lastFailureTime: now,
            state: "open" as const,
            successes: 0,
          };
        }

        return { ...state, failures: newFailures, lastFailureTime: now };
      });
    });

    const execute = <A, E, R>(
      effect: Effect.Effect<A, E, R>
    ): Effect.Effect<A, E | CircuitOpenError, R> =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;

        // Atomically decide admission and perform the open -> half-open promotion in
        // a single Ref.modify. Doing the read, promote, and reject check as separate
        // steps allows concurrent fibers to race (TOCTOU): the modify collapses them
        // into one coherent transition so the half-open promotion happens exactly once.
        type Admission =
          | { readonly admitted: true }
          | { readonly admitted: false; readonly openedAt: number };
        const admission = yield* Ref.modify(
          stateRef,
          (state): readonly [Admission, CircuitBreakerState] => {
            if (state.state === "open") {
              if (now - state.lastFailureTime >= resetTimeout) {
                // Recovery window elapsed: promote to half-open and admit this probe.
                return [
                  { admitted: true },
                  { ...state, state: "half-open" as const, successes: 0 },
                ];
              }
              // Still open: reject without mutating state.
              return [{ admitted: false, openedAt: state.lastFailureTime }, state];
            }
            // Closed or half-open: admit.
            return [{ admitted: true }, state];
          }
        );

        // Reject if circuit is open
        if (!admission.admitted) {
          return yield* Effect.fail(
            new CircuitOpenError({
              message: "Circuit breaker is open",
              openedAt: admission.openedAt,
            })
          );
        }

        // Execute the effect and track success/failure
        const result = yield* Effect.matchEffect(effect, {
          onFailure: (error) =>
            Effect.gen(function* () {
              yield* recordFailure;
              return yield* Effect.fail(error);
            }),
          onSuccess: (value) =>
            Effect.gen(function* () {
              yield* recordSuccess;
              return value;
            }),
        });

        return result;
      });

    const getState = Effect.gen(function* () {
      const state = yield* Ref.get(stateRef);
      return state.state;
    });

    const reset = Ref.set(stateRef, {
      failures: 0,
      lastFailureTime: 0,
      state: "closed" as const,
      successes: 0,
    });

    return {
      execute,
      getState,
      reset,
    } satisfies CircuitBreaker;
  });
};
