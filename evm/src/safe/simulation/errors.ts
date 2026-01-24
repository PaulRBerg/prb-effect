/**
 * Tagged errors for Safe multisig gas simulation operations.
 *
 * These errors use Effect-TS Schema.TaggedError pattern for type-safe error handling.
 */
import { Schema } from "effect";

/** Gas consumption exceeds block gas limit threshold */
export class GasLimitOverflowError extends Schema.TaggedError<GasLimitOverflowError>()(
  "GasLimitOverflowError",
  {
    blockGasLimit: Schema.BigInt,
    estimatedGas: Schema.BigInt,
    message: Schema.String,
    threshold: Schema.BigInt,
  }
) {}

/** Safe simulation failed */
export class SafeMultisigSimulationFailedError extends Schema.TaggedError<SafeMultisigSimulationFailedError>()(
  "SafeMultisigSimulationFailedError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
  }
) {}

/** Safe contracts not deployed on this chain */
export class SafeMultisigContractsNotDeployedError extends Schema.TaggedError<SafeMultisigContractsNotDeployedError>()(
  "SafeMultisigContractsNotDeployedError",
  {
    chainId: Schema.Number,
    message: Schema.String,
    missingContract: Schema.Literal("multiSend", "simulateAccessor"),
  }
) {}

/** Transaction size too large */
export class TxSizeTooLargeError extends Schema.TaggedError<TxSizeTooLargeError>()(
  "TxSizeTooLargeError",
  {
    actualSize: Schema.Number,
    maxSize: Schema.Number,
    message: Schema.String,
  }
) {}

/** Simulation revert data decode failed */
export class SimulationDecodeError extends Schema.TaggedError<SimulationDecodeError>()(
  "SimulationDecodeError",
  {
    cause: Schema.Unknown,
    message: Schema.String,
    revertData: Schema.String,
  }
) {}

/** Invalid gas threshold percent */
export class InvalidGasThresholdError extends Schema.TaggedError<InvalidGasThresholdError>()(
  "InvalidGasThresholdError",
  {
    message: Schema.String,
    value: Schema.Number,
  }
) {}
