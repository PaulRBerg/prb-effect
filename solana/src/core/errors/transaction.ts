import { Schema } from "effect";

export class TransactionSendError extends Schema.TaggedError<TransactionSendError>()(
  "TransactionSendError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
    signature: Schema.optional(Schema.String),
  }
) {}

export class TransactionFailedError extends Schema.TaggedError<TransactionFailedError>()(
  "TransactionFailedError",
  {
    logs: Schema.optional(Schema.Array(Schema.String)),
    message: Schema.String,
    signature: Schema.String,
  }
) {}

export class TransactionTimeoutError extends Schema.TaggedError<TransactionTimeoutError>()(
  "TransactionTimeoutError",
  {
    message: Schema.String,
    signature: Schema.String,
  }
) {}

export class BlockhashExpiredError extends Schema.TaggedError<BlockhashExpiredError>()(
  "BlockhashExpiredError",
  {
    blockhash: Schema.String,
    message: Schema.String,
  }
) {}

export class SimulationFailedError extends Schema.TaggedError<SimulationFailedError>()(
  "SimulationFailedError",
  {
    cause: Schema.optional(Schema.Unknown),
    logs: Schema.optional(Schema.Array(Schema.String)),
    message: Schema.String,
  }
) {}
