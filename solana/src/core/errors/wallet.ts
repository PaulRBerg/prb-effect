import { Schema } from "effect";

export class WalletNotConnectedError extends Schema.TaggedError<WalletNotConnectedError>()(
  "WalletNotConnectedError",
  {
    message: Schema.String,
  }
) {}

export class SignatureError extends Schema.TaggedError<SignatureError>()("SignatureError", {
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
}) {}

export class UserRejectedError extends Schema.TaggedError<UserRejectedError>()(
  "UserRejectedError",
  {
    message: Schema.String,
  }
) {}
