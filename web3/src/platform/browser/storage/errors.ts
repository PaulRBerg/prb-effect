import { Schema } from "effect";

/**
 * Error thrown when browser storage is unavailable.
 * This can occur in SSR contexts, when storage is blocked by browser settings,
 * or when a SecurityError is thrown by the browser.
 */
export class StorageUnavailableError extends Schema.TaggedError<StorageUnavailableError>()(
  "StorageUnavailableError",
  {
    message: Schema.String,
  }
) {}

/**
 * Error thrown when storage quota is exceeded.
 * Occurs when attempting to store data beyond the browser's storage limit.
 */
export class StorageQuotaExceededError extends Schema.TaggedError<StorageQuotaExceededError>()(
  "StorageQuotaExceededError",
  {
    key: Schema.String,
    message: Schema.String,
  }
) {}

/**
 * Error thrown when stored data cannot be decoded.
 * This can occur due to schema mismatches or data corruption.
 */
export class StorageDecodeError extends Schema.TaggedError<StorageDecodeError>()(
  "StorageDecodeError",
  {
    cause: Schema.Unknown,
    key: Schema.String,
    message: Schema.String,
  }
) {}

/**
 * Union type of all storage errors.
 */
export type StorageError = StorageUnavailableError | StorageQuotaExceededError | StorageDecodeError;
