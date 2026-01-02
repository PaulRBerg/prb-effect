import { Schema } from "effect";

export class SimulationError extends Schema.TaggedError<SimulationError>()("SimulationError", {
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
}) {}

export class TenderlyApiError extends Schema.TaggedError<TenderlyApiError>()("TenderlyApiError", {
  message: Schema.String,
  response: Schema.optional(Schema.Unknown),
  statusCode: Schema.Number,
}) {}

export class TenderlyRateLimitError extends Schema.TaggedError<TenderlyRateLimitError>()(
  "TenderlyRateLimitError",
  {
    message: Schema.String,
    retryAfter: Schema.optional(Schema.Number),
  }
) {}

export class TenderlyNotConfiguredError extends Schema.TaggedError<TenderlyNotConfiguredError>()(
  "TenderlyNotConfiguredError",
  {
    message: Schema.String,
    missingConfig: Schema.Array(Schema.String),
  }
) {}
