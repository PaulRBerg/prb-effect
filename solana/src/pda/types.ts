import { Schema } from "effect";

export class PdaDerivationError extends Schema.TaggedError<PdaDerivationError>()(
  "PdaDerivationError",
  {
    cause: Schema.Unknown,
    message: Schema.String,
    programAddress: Schema.optional(Schema.String),
  }
) {}
