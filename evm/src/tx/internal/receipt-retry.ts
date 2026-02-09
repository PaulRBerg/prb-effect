import { Schedule } from "effect";
import {
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import type { ReceiptTimeoutError, TxFailedError, TxReplacedError } from "#src/core/index.js";
import { makeBackoffSchedule } from "#src/internal/index.js";
import { defaultRetryableErrors, isRetryableError } from "#src/rpc/index.js";

/**
 * Error patterns that should trigger retry during receipt polling.
 * Extends default RPC error patterns with receipt-specific transient errors.
 *
 * Viem error messages:
 * - TransactionNotFoundError: "Transaction could not be found"
 * - TransactionReceiptNotFoundError: "Transaction receipt with hash ... could not be found"
 *
 * Other RPC providers may use different wording, so we include common variants.
 * Patterns are specific to avoid matching unrelated errors like "method could not be found".
 */
export const receiptRetryablePatterns = [
  ...defaultRetryableErrors,
  "timed out", // viem's WaitForTransactionReceiptTimeoutError message
  "transaction with hash", // viem's TransactionNotFoundError
  "receipt with hash", // viem's TransactionReceiptNotFoundError
  "transaction not found", // Common RPC provider message
  "receipt not found", // Common RPC provider message
  "could not find transaction", // Alternative RPC provider phrasing
  "receipt could not be found", // Alternative RPC provider phrasing
  "transaction receipt could not be found", // Alternative without "with hash"
  "transaction could not be found", // Simple phrasing (no hash in message)
];

/**
 * Creates a retry schedule for receipt polling.
 * Only retries TxFailedError when the cause is a transient RPC error.
 * Uses existing backoff infrastructure with longer base delay for receipt polling.
 *
 * Timeout behavior:
 * - ReceiptTimeoutError is terminal (represents total budget exhaustion).
 * - Transport/receipt polling timeouts (from defaultRetryableErrors) are retried while budget remains.
 */
function isReceiptRetryable(cause: unknown): boolean {
  if (
    cause instanceof TransactionNotFoundError ||
    cause instanceof TransactionReceiptNotFoundError ||
    cause instanceof WaitForTransactionReceiptTimeoutError
  ) {
    return true;
  }

  return isRetryableError(cause, receiptRetryablePatterns);
}

export const makeReceiptRetrySchedule = () =>
  makeBackoffSchedule({ baseDelay: 1000, jitter: true, maxRetries: 3 }).pipe(
    Schedule.whileInput<TxFailedError | ReceiptTimeoutError | TxReplacedError>((error) => {
      // Only retry TxFailedError with retryable cause - not timeouts or replacements
      if (error._tag === "TxFailedError" && error.cause) {
        return isReceiptRetryable(error.cause);
      }
      return false;
    })
  );
