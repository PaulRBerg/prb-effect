/**
 * Final evaluation of simulation outcomes against policy thresholds.
 */
import { Effect } from "effect";
import { GasLimitOverflowError, SafeMultisigSimulationFailedError } from "../../errors.js";
import type { SafeMultisigSimulationResult } from "../../types.js";
import type { LatestBlock, SimulationDecoded } from "../types/index.js";

/**
 * Apply success and gas threshold checks to the decoded result.
 */
export function evaluateSimulationResult(
  result: SimulationDecoded,
  block: LatestBlock,
  gasThresholdPercent?: number
): Effect.Effect<
  SafeMultisigSimulationResult,
  GasLimitOverflowError | SafeMultisigSimulationFailedError
> {
  const threshold = (block.gasLimit * BigInt(gasThresholdPercent ?? 95)) / 100n;

  if (result.success && result.gas > threshold) {
    return Effect.fail(
      new GasLimitOverflowError({
        blockGasLimit: block.gasLimit,
        estimatedGas: result.gas,
        message:
          "Gas consumption exceeds threshold of block gas limit. Try splitting into smaller batches.",
        threshold,
      })
    );
  }

  if (!result.success) {
    return Effect.fail(
      new SafeMultisigSimulationFailedError({
        message: "Transaction simulation failed - the transaction would revert",
      })
    );
  }

  return Effect.succeed({ estimatedGas: result.gas, success: true });
}
