/**
 * Resolve contract addresses needed to construct Safe simulation calldata.
 */
import { Effect } from "effect";
import { getMultiSendAddress, getSimulateAccessorAddress } from "../../addresses.js";
import { SafeContractsNotDeployedError } from "../../errors.js";
import type { SafeContracts } from "../types/index.js";

/**
 * Resolve the Safe helper contract addresses for the chain.
 */
export function resolveSafeContracts(
  chainId: number
): Effect.Effect<SafeContracts, SafeContractsNotDeployedError> {
  return Effect.gen(function* () {
    const multiSendAddr = getMultiSendAddress(chainId);
    const simulateAccessorAddr = getSimulateAccessorAddress(chainId);

    if (!multiSendAddr) {
      return yield* Effect.fail(
        new SafeContractsNotDeployedError({
          chainId,
          message: "MultiSend contract not deployed on this chain",
          missingContract: "multiSend",
        })
      );
    }

    if (!simulateAccessorAddr) {
      return yield* Effect.fail(
        new SafeContractsNotDeployedError({
          chainId,
          message: "SimulateAccessor contract not deployed on this chain",
          missingContract: "simulateAccessor",
        })
      );
    }

    return { multiSendAddr, simulateAccessorAddr };
  });
}
