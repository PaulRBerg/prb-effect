import { Schedule } from "effect";
import type { ReceiptTimeoutError, TxFailedError, TxReplacedError } from "@/src/core/index.js";
import { makeBackoffSchedule } from "@/src/internal/index.js";
import { defaultRetryableErrors, isRetryableError } from "@/src/rpc/index.js";

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
 * - WaitForTransactionReceiptTimeoutError → ReceiptTimeoutError (terminal, not retried)
 *   This means the tx wasn't confirmed in time - retrying won't help.
 * - HTTP/transport timeouts (from defaultRetryableErrors) → retried
 *   These are transient network issues, not confirmation failures.
 */
export const makeReceiptRetrySchedule = () =>
  makeBackoffSchedule({ baseDelay: 1000, jitter: true, maxRetries: 3 }).pipe(
    Schedule.whileInput<TxFailedError | ReceiptTimeoutError | TxReplacedError>((error) => {
      // Only retry TxFailedError with retryable cause - not timeouts or replacements
      if (error._tag === "TxFailedError" && error.cause) {
        return isRetryableError(error.cause, receiptRetryablePatterns);
      }
      return false;
    })
  );
