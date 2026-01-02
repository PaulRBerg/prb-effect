import { Schema } from "effect";

export class AccountNotFoundError extends Schema.TaggedError<AccountNotFoundError>()(
  "AccountNotFoundError",
  {
    address: Schema.String,
    message: Schema.String,
  }
) {}

export class InsufficientBalanceError extends Schema.TaggedError<InsufficientBalanceError>()(
  "InsufficientBalanceError",
  {
    address: Schema.String,
    available: Schema.BigInt,
    message: Schema.String,
    required: Schema.BigInt,
  }
) {}
