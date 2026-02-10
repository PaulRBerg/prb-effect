import { Schema } from "effect";

// SDK availability errors
export class SafeAppsSdkUnavailableError extends Schema.TaggedError<SafeAppsSdkUnavailableError>()(
  "SafeAppsSdkUnavailableError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String }
) {}

export class NotInSafeAppContextError extends Schema.TaggedError<NotInSafeAppContextError>()(
  "NotInSafeAppContextError",
  { message: Schema.String }
) {}

// Safe operation errors
export class SafeMultisigInfoUnavailableError extends Schema.TaggedError<SafeMultisigInfoUnavailableError>()(
  "SafeMultisigInfoUnavailableError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String }
) {}

export class SafeMultisigSettingsError extends Schema.TaggedError<SafeMultisigSettingsError>()(
  "SafeMultisigSettingsError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String }
) {}

export class SafeMultisigTxSubmissionError extends Schema.TaggedError<SafeMultisigTxSubmissionError>()(
  "SafeMultisigTxSubmissionError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String }
) {}

export class SafeMultisigTxLookupError extends Schema.TaggedError<SafeMultisigTxLookupError>()(
  "SafeMultisigTxLookupError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
    retryable: Schema.Boolean,
    safeTxHash: Schema.String,
  }
) {}

export class SafeMultisigTxExecutionTimeoutError extends Schema.TaggedError<SafeMultisigTxExecutionTimeoutError>()(
  "SafeMultisigTxExecutionTimeoutError",
  {
    lastStatus: Schema.optional(Schema.String),
    message: Schema.String,
    safeTxHash: Schema.String,
    timeout: Schema.Number,
  }
) {}

// Signing errors
export class SignTypedDataError extends Schema.TaggedError<SignTypedDataError>()(
  "SignTypedDataError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String }
) {}

export class OffchainSignatureTimeoutError extends Schema.TaggedError<OffchainSignatureTimeoutError>()(
  "OffchainSignatureTimeoutError",
  {
    message: Schema.String,
    messageHash: Schema.String,
    timeout: Schema.Number,
  }
) {}

// MultiSend errors

export class SafeMultiSendUnavailableError extends Schema.TaggedError<SafeMultiSendUnavailableError>()(
  "SafeMultiSendUnavailableError",
  {
    cause: Schema.optional(Schema.Unknown),
    chainId: Schema.optional(Schema.Number),
    message: Schema.String,
  }
) {}

// MultiSend error detection

const MULTISEND_ERROR_PATTERN = /MultiSend contract not deployed|MultiSend call failed/i;
const MAX_ERROR_DEPTH = 10;

/**
 * Check if an error is caused by MultiSend contract unavailability.
 * Recursively checks error messages and causes for MultiSend-related strings.
 */
export function isMultiSendUnavailableError(error: unknown): boolean {
  return checkMultiSendError(error, 0);
}

function checkMultiSendError(error: unknown, depth: number): boolean {
  if (depth >= MAX_ERROR_DEPTH) {
    return false;
  }

  if (typeof error === "string") {
    return MULTISEND_ERROR_PATTERN.test(error);
  }

  if (typeof error === "object" && error !== null) {
    const { message, cause } = error as { message?: unknown; cause?: unknown };

    if (typeof message === "string" && MULTISEND_ERROR_PATTERN.test(message)) {
      return true;
    }

    if (cause) {
      return checkMultiSendError(cause, depth + 1);
    }
  }

  return false;
}
