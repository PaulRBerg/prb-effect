import { Schema } from "effect";

export class GasPriceUnavailableError extends Schema.TaggedError<GasPriceUnavailableError>()(
  "GasPriceUnavailableError",
  {
    cause: Schema.optional(Schema.Unknown),
    chainId: Schema.Number,
    message: Schema.String,
  }
) {}
