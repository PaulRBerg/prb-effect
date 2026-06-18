import { Schema } from "effect";

export class WalletNotConnectedError extends Schema.TaggedError<WalletNotConnectedError>()(
  "WalletNotConnectedError",
  {
    message: Schema.String,
  }
) {}

export class WalletCapabilityError extends Schema.TaggedError<WalletCapabilityError>()(
  "WalletCapabilityError",
  {
    capability: Schema.String,
    message: Schema.String,
  }
) {}

export class SignatureError extends Schema.TaggedError<SignatureError>()("SignatureError", {
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
}) {}
