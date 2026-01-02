import { Schema } from "effect";

export class ContractReadError extends Schema.TaggedError<ContractReadError>()(
  "ContractReadError",
  {
    address: Schema.String,
    cause: Schema.optional(Schema.Unknown),
    functionName: Schema.String,
    message: Schema.String,
  }
) {}

export class SimulationFailedError extends Schema.TaggedError<SimulationFailedError>()(
  "SimulationFailedError",
  {
    address: Schema.String,
    calldata: Schema.optional(Schema.String),
    functionName: Schema.String,
    message: Schema.String,
    revertData: Schema.optional(Schema.String),
    sender: Schema.optional(Schema.String),
  }
) {}

export class GasEstimationError extends Schema.TaggedError<GasEstimationError>()(
  "GasEstimationError",
  {
    address: Schema.String,
    calldata: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Unknown),
    functionName: Schema.String,
    message: Schema.String,
    sender: Schema.optional(Schema.String),
  }
) {}

export class ContractWriteError extends Schema.TaggedError<ContractWriteError>()(
  "ContractWriteError",
  {
    address: Schema.String,
    calldata: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Unknown),
    functionName: Schema.String,
    message: Schema.String,
    sender: Schema.optional(Schema.String),
  }
) {}

export class MulticallError extends Schema.TaggedError<MulticallError>()("MulticallError", {
  cause: Schema.optional(Schema.Unknown),
  failedCalls: Schema.Number,
  message: Schema.String,
}) {}
