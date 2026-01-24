/**
 * Resolve contract addresses needed to construct Safe simulation calldata.
 */
import { Effect } from "effect";
import { getMultiSendAddress, getSimulateAccessorAddress } from "../../addresses.js";
import { SafeMultisigContractsNotDeployedError } from "../../errors.js";
import type { SafeMultisigContracts } from "../types/index.js";

/**
 * Resolve the Safe helper contract addresses for the chain.
 */
export function resolveSafeMultisigContracts(
  chainId: number
): Effect.Effect<SafeMultisigContracts, SafeMultisigContractsNotDeployedError> {
  return Effect.gen(function* () {
    const multiSendAddr = getMultiSendAddress(chainId);
    const simulateAccessorAddr = getSimulateAccessorAddress(chainId);

    if (!multiSendAddr) {
      return yield* Effect.fail(
        new SafeMultisigContractsNotDeployedError({
          chainId,
          message: "MultiSend contract not deployed on this chain",
          missingContract: "multiSend",
        })
      );
    }

    if (!simulateAccessorAddr) {
      return yield* Effect.fail(
        new SafeMultisigContractsNotDeployedError({
          chainId,
          message: "SimulateAccessor contract not deployed on this chain",
          missingContract: "simulateAccessor",
        })
      );
    }

    return { multiSendAddr, simulateAccessorAddr };
  });
}
