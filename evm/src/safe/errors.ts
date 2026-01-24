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
