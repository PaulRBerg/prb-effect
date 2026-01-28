import { Schedule } from "effect";
import type {
  ReceiptTimeoutError,
  TransactionFailedError,
  TransactionReplacedError,
} from "@/src/core/index.js";
import { makeBackoffSchedule } from "@/src/internal/index.js";
import { defaultRetryableErrors, isRetryableError } from "@/src/rpc/index.js";

/**
 * Error patterns that should trigger retry during receipt polling.
 * Extends default RPC error patterns with receipt-specific transient errors.
 * Patterns are intentionally specific to avoid matching unrelated "not found" errors.
 */
export const receiptRetryablePatterns = [
  ...defaultRetryableErrors,
  "transaction not found",
  "receipt not found",
  "could not find transaction",
];

/**
 * Creates a retry schedule for receipt polling.
 * Only retries TransactionFailedError when the cause is a transient RPC error.
 * Uses existing backoff infrastructure with longer base delay for receipt polling.
 */
export const makeReceiptRetrySchedule = () =>
  makeBackoffSchedule({ baseDelay: 1000, jitter: true, maxRetries: 3 }).pipe(
    Schedule.whileInput<TransactionFailedError | ReceiptTimeoutError | TransactionReplacedError>(
      (error) => {
        // Only retry TransactionFailedError with retryable cause - not timeouts or replacements
        if (error._tag === "TransactionFailedError" && error.cause) {
          return isRetryableError(error.cause, receiptRetryablePatterns);
        }
        return false;
      }
    )
  );
