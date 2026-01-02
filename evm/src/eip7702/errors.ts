import { Schema } from "effect";

export class Eip7702AuthorizationSigningError extends Schema.TaggedError<Eip7702AuthorizationSigningError>()(
  "Eip7702AuthorizationSigningError",
  {
    cause: Schema.optional(Schema.Unknown),
    chainId: Schema.Number,
    message: Schema.String,
  }
) {}

export class Eip7702AuthorizationPreparationError extends Schema.TaggedError<Eip7702AuthorizationPreparationError>()(
  "Eip7702AuthorizationPreparationError",
  {
    cause: Schema.optional(Schema.Unknown),
    chainId: Schema.Number,
    message: Schema.String,
  }
) {}

export class Eip7702SendTransactionError extends Schema.TaggedError<Eip7702SendTransactionError>()(
  "Eip7702SendTransactionError",
  {
    cause: Schema.optional(Schema.Unknown),
    chainId: Schema.Number,
    message: Schema.String,
  }
) {}
