/**
 * Calldata construction utilities for Safe simulation.
 */
import type { Hex } from "viem";
import { encodeFunctionData } from "viem";
import { safeAbis } from "../../abis.js";
import { encodeMultiSend } from "../../encoding.js";
import type { SafeMultisigSimulateBatchParams } from "../../types.js";
import type { SafeMultisigContracts } from "../types/index.js";

/**
 * Build the final simulateAndRevert calldata for Safe.
 */
export function buildSafeCalldata(
  contracts: SafeMultisigContracts,
  transactions: SafeMultisigSimulateBatchParams["transactions"]
): Hex {
  const multiSendCalldata = encodeMultiSend(transactions);

  const simulateAccessorCalldata = encodeFunctionData({
    abi: safeAbis.simulateAccessor,
    args: [contracts.multiSendAddr, 0n, multiSendCalldata, 1], // 1 = DelegateCall
    functionName: "simulate",
  });

  return encodeFunctionData({
    abi: safeAbis.multisig,
    args: [contracts.simulateAccessorAddr, simulateAccessorCalldata],
    functionName: "simulateAndRevert",
  });
}
