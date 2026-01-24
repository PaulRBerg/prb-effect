/**
 * Input validation for Safe batch simulation parameters.
 */
import { Effect } from "effect";
import { zeroAddress } from "viem";
import { InvalidGasThresholdError, SafeMultisigSimulationFailedError } from "../../errors.js";
import type { SafeMultisigSimulateBatchParams } from "../../types.js";

/**
 * Validate user-supplied simulation inputs before any chain calls.
 */
export function validateSimulationParams(
  params: SafeMultisigSimulateBatchParams
): Effect.Effect<
  SafeMultisigSimulateBatchParams,
  InvalidGasThresholdError | SafeMultisigSimulationFailedError
> {
  return Effect.gen(function* () {
    const { gasThresholdPercent, safeAddress, transactions } = params;

    if (transactions.length === 0) {
      return yield* Effect.fail(
        new SafeMultisigSimulationFailedError({
          message: "Cannot simulate empty transaction batch",
        })
      );
    }

    if (safeAddress === zeroAddress) {
      return yield* Effect.fail(
        new SafeMultisigSimulationFailedError({
          message: "Invalid Safe address: cannot be zero address",
        })
      );
    }

    if (
      gasThresholdPercent !== undefined &&
      (gasThresholdPercent < 1 || gasThresholdPercent > 100)
    ) {
      return yield* Effect.fail(
        new InvalidGasThresholdError({
          message: "gasThresholdPercent must be between 1 and 100 (inclusive)",
          value: gasThresholdPercent,
        })
      );
    }

    return params;
  });
}
