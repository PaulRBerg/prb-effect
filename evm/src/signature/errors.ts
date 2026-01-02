import { Schema } from "effect";

export class SignatureVerificationError extends Schema.TaggedError<SignatureVerificationError>()(
  "SignatureVerificationError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
    signature: Schema.String,
  }
) {}

export class SignatureRecoveryError extends Schema.TaggedError<SignatureRecoveryError>()(
  "SignatureRecoveryError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
    signature: Schema.String,
  }
) {}

export class InvalidSignatureError extends Schema.TaggedError<InvalidSignatureError>()(
  "InvalidSignatureError",
  {
    message: Schema.String,
    signature: Schema.String,
  }
) {}
