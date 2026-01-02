import { Duration, Schedule } from "effect";

/**
 * Configuration for exponential backoff with optional jitter
 */
export type BackoffConfig = {
  /** Maximum number of retry attempts (default: 3) */
  readonly maxRetries?: number;
  /** Base delay in milliseconds (default: 100) */
  readonly baseDelay?: number;
  /** Maximum delay cap in milliseconds (default: 10_000) */
  readonly maxDelay?: number;
  /** Add jitter to delays (default: true) */
  readonly jitter?: boolean;
};

/**
 * Create an exponential backoff schedule with configurable parameters.
 * Combines exponential delay growth with max cap and optional jitter.
 */
export const makeBackoffSchedule = (config?: BackoffConfig): Schedule.Schedule<number> => {
  const { maxRetries = 3, baseDelay = 100, maxDelay = 10_000, jitter = true } = config ?? {};

  // Build base schedule: recurs with exponential delays capped at maxDelay
  const base = Schedule.recurs(maxRetries).pipe(
    Schedule.modifyDelay((attempt, _) => {
      const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
      return Duration.millis(delay);
    })
  );

  return jitter ? Schedule.jittered(base) : base;
};
