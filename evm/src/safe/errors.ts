import { Schema } from "effect";

// SDK availability errors
export class SafeSdkUnavailableError extends Schema.TaggedError<SafeSdkUnavailableError>()(
  "SafeSdkUnavailableError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String }
) {}

export class NotInSafeAppContextError extends Schema.TaggedError<NotInSafeAppContextError>()(
  "NotInSafeAppContextError",
  { message: Schema.String }
) {}

// Safe operation errors
export class SafeInfoUnavailableError extends Schema.TaggedError<SafeInfoUnavailableError>()(
  "SafeInfoUnavailableError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String }
) {}

export class SafeSettingsError extends Schema.TaggedError<SafeSettingsError>()(
  "SafeSettingsError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String }
) {}

export class SafeTxSubmissionError extends Schema.TaggedError<SafeTxSubmissionError>()(
  "SafeTxSubmissionError",
  { cause: Schema.optional(Schema.Unknown), message: Schema.String }
) {}

export class SafeTxLookupError extends Schema.TaggedError<SafeTxLookupError>()(
  "SafeTxLookupError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
    retryable: Schema.Boolean,
    safeTxHash: Schema.String,
  }
) {}

export class SafeTxExecutionTimeoutError extends Schema.TaggedError<SafeTxExecutionTimeoutError>()(
  "SafeTxExecutionTimeoutError",
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
