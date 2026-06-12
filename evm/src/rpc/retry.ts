import { Config, Effect, Schedule } from "effect";
import type { BackoffConfig } from "#src/internal/index.js";
import { makeBackoffSchedule } from "#src/internal/index.js";

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
 * import { RetryConfigFromEnv } from "effect-evm/rpc";
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
 * Patterns made of digits and/or word characters only (e.g. HTTP status codes
 * like "429"/"502" or errno tokens like "ECONNRESET") are matched at word
 * boundaries. Plain substring matching lets them false-match unrelated content
 * such as a 0x-prefixed tx hash that happens to embed "429". Multi-word phrases
 * ("rate limit", "timeout") still use substring matching.
 */
const WORDLIKE_PATTERN = /^\w+$/;

const isWordlikePattern = (pattern: string): boolean => WORDLIKE_PATTERN.test(pattern);

const patternMatches = (message: string, pattern: string): boolean => {
  const needle = pattern.toLowerCase();
  if (isWordlikePattern(needle)) {
    return new RegExp(`\\b${needle}\\b`).test(message);
  }
  return message.includes(needle);
};

/**
 * Check if an error should be retried based on its message.
 * Handles Error instances, strings, and plain objects with a message property.
 */
export const isRetryableError = (error: unknown, retryablePatterns: string[]): boolean => {
  const matchMessage = (message: string): boolean =>
    retryablePatterns.some((pattern) => patternMatches(message, pattern));

  if (error instanceof Error) {
    return matchMessage(error.message.toLowerCase());
  }
  if (typeof error === "string") {
    return matchMessage(error.toLowerCase());
  }
  // Handle plain objects with message property (some RPC transports throw these)
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return matchMessage(error.message.toLowerCase());
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
