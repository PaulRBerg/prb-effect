import { Schema } from "effect";
import type { Hash, Hex } from "viem";

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
const USER_REJECTION_CODE = 4001;
const MAX_ERROR_MESSAGE_DEPTH = 10;

type ErrorMessageShape = {
  readonly cause?: unknown;
  readonly code?: unknown;
  readonly error?: unknown;
  readonly errors?: unknown;
  readonly message?: unknown;
  readonly shortMessage?: unknown;
};

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isUserRejectionCode(code: unknown): boolean {
  return code === USER_REJECTION_CODE || code === `${USER_REJECTION_CODE}`;
}

function getSafeErrorMessageInternal(error: unknown, depth: number): string | undefined {
  if (!error || depth >= MAX_ERROR_MESSAGE_DEPTH) {
    return undefined;
  }

  if (typeof error === "string") {
    return toNonEmptyString(error);
  }

  if (error instanceof Error) {
    if (isUserRejectionCode((error as { code?: unknown }).code)) {
      return "User rejected the request";
    }

    const shortMessage = toNonEmptyString((error as { shortMessage?: unknown }).shortMessage);
    if (shortMessage) {
      return shortMessage;
    }

    const message = toNonEmptyString(error.message);
    if (message) {
      return message;
    }

    return getSafeErrorMessageInternal((error as { cause?: unknown }).cause, depth + 1);
  }

  if (typeof error !== "object") {
    return undefined;
  }

  const typedError = error as ErrorMessageShape;

  if (isUserRejectionCode(typedError.code)) {
    return "User rejected the request";
  }

  const shortMessage = toNonEmptyString(typedError.shortMessage);
  if (shortMessage) {
    return shortMessage;
  }

  const message = toNonEmptyString(typedError.message);
  if (message) {
    return message;
  }

  const causeMessage = getSafeErrorMessageInternal(typedError.cause, depth + 1);
  if (causeMessage) {
    return causeMessage;
  }

  const nestedErrorMessage = getSafeErrorMessageInternal(typedError.error, depth + 1);
  if (nestedErrorMessage) {
    return nestedErrorMessage;
  }

  if (!Array.isArray(typedError.errors)) {
    return undefined;
  }

  for (const nestedError of typedError.errors) {
    const nestedMessage = getSafeErrorMessageInternal(nestedError, depth + 1);
    if (nestedMessage) {
      return nestedMessage;
    }
  }

  return undefined;
}

/**
 * Best-effort extraction of a human-readable Safe SDK error message.
 * Preserves nested `cause` / `error` chains and handles EIP-1193 user rejection codes.
 */
export function getSafeErrorMessage(error: unknown): string | undefined {
  return getSafeErrorMessageInternal(error, 0);
}

/**
 * Canonical constructor for Safe tx lookup errors.
 */
export function toSafeMultisigTxLookupError(
  safeTxHash: Hash | Hex,
  cause: unknown,
  retryable = true
): SafeMultisigTxLookupError {
  const detail = getSafeErrorMessage(cause);
  return new SafeMultisigTxLookupError({
    cause,
    message: detail
      ? `Failed to lookup Safe tx ${safeTxHash}: ${detail}`
      : `Failed to lookup Safe tx ${safeTxHash}`,
    retryable,
    safeTxHash,
  });
}

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
