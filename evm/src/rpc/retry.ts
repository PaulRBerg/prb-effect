import { Config, Effect, Schedule } from "effect";
import type { BackoffConfig } from "@/src/internal/index.js";
import { makeBackoffSchedule } from "@/src/internal/index.js";

export type RetryConfig = BackoffConfig & {
  /** Array of error message patterns that should trigger retries */
  retryableErrors?: string[];
};

/**
 * Config-based retry configuration from environment variables.
 *
 * Environment variables (all optional, nested under `EW3_RETRY_` prefix):
 * - `EW3_RETRY_MAX_RETRIES`: Maximum retry attempts (default: 3)
 * - `EW3_RETRY_BASE_DELAY`: Base delay in milliseconds (default: 100)
 * - `EW3_RETRY_MAX_DELAY`: Maximum delay cap in milliseconds (default: 10_000)
 * - `EW3_RETRY_JITTER`: Enable jitter for delays (default: true)
 *
 * @example
 * ```typescript
 * import { Effect } from "effect";
 * import { RetryConfigFromEnv } from "effect-web3/rpc";
 *
 * const program = Effect.gen(function* () {
 *   const config = yield* RetryConfigFromEnv;
 *   // Use config for retry logic
 * });
 * ```
 */
export const RetryConfigFromEnv = Config.all({
  baseDelay: Config.number("BASE_DELAY").pipe(Config.withDefault(100)),
  jitter: Config.boolean("JITTER").pipe(Config.withDefault(true)),
  maxDelay: Config.number("MAX_DELAY").pipe(Config.withDefault(10_000)),
  maxRetries: Config.number("MAX_RETRIES").pipe(Config.withDefault(3)),
}).pipe(Config.nested("EW3_RETRY"));

/**
 * Default retryable error patterns for RPC calls
 * Includes rate limits, timeouts, network errors, and transient HTTP errors
 */
export const defaultRetryableErrors = [
  "rate limit",
  "timeout",
  "ECONNRESET",
  "ETIMEDOUT",
  "503",
  "502",
  "429",
];

/**
 * Check if an error should be retried based on its message
 */
const isRetryableError = (error: unknown, retryablePatterns: string[]): boolean => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return retryablePatterns.some((pattern) => message.includes(pattern.toLowerCase()));
  }
  if (typeof error === "string") {
    const message = error.toLowerCase();
    return retryablePatterns.some((pattern) => message.includes(pattern.toLowerCase()));
  }
  return false;
};

/**
 * Create a retry schedule with exponential backoff
 * Only retries on errors matching the configured retryable patterns
 *
 * @param config - Retry configuration options
 * @returns Schedule that implements exponential backoff with jitter
 */
export const makeRetrySchedule = <E>(config?: RetryConfig): Schedule.Schedule<number, E> => {
  const { retryableErrors = defaultRetryableErrors, ...backoffConfig } = config ?? {};

  return makeBackoffSchedule(backoffConfig).pipe(
    Schedule.whileInput<E>((error) => isRetryableError(error, retryableErrors))
  );
};

/**
 * Apply retry logic to an Effect
 * Will retry the effect according to the configured schedule on retryable errors
 *
 * @param effect - The Effect to retry
 * @param config - Retry configuration options
 * @returns Effect that will be retried on transient failures
 */
export const withRetry =
  (config?: RetryConfig) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.retry(effect, makeRetrySchedule<E>(config));
