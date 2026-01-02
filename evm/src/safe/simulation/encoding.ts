/**
 * Encoding utilities for Safe multisig batch transactions.
 *
 * Based on Safe's multiSend encoding scheme and simulation data decoding.
 * @see https://github.com/safe-global/safe-smart-account/blob/c4859f4/contracts/common/StorageAccessible.sol#L32-L43
 * @see https://github.com/safe-global/safe-core-sdk/blob/4f4a0f6/packages/protocol-kit/src/utils/transactions/gas.ts#L353-L358
 */
import type { Address, Hex } from "viem";
import { decodeAbiParameters, encodeFunctionData, encodePacked } from "viem";
import { safeAbis } from "./abis.js";
import type { SafeSimulationTransaction } from "./types.js";

/** Internal transaction format for Safe multiSend encoding */
type InternalTransaction = {
  data: Hex;
  operation: 0 | 1;
  to: Address;
  value: bigint;
};

/**
 * Encode a single transaction for Safe's multiSend batch execution.
 *
 * Packs transaction data into Safe's internal transaction format using tight encoding:
 * - `operation` (uint8): 0 for CALL, 1 for DELEGATECALL
 * - `to` (address): Target contract address
 * - `value` (uint256): ETH value to send
 * - `dataLength` (uint256): Byte length of calldata
 * - `data` (bytes): ABI-encoded function call
 *
 * The encoding follows Safe's multiSend contract specification where multiple transactions
 * are concatenated into a single bytes payload.
 *
 * @param tx - Transaction to encode
 * @returns Hex-encoded transaction bytes without 0x prefix (for concatenation with other transactions)
 *
 * @see https://github.com/safe-global/safe-smart-account/blob/c4859f4/contracts/common/StorageAccessible.sol#L32-L43
 */
export function encodeInternalTransaction(tx: InternalTransaction): string {
  const encoded = encodePacked(
    ["uint8", "address", "uint256", "uint256", "bytes"],
    [tx.operation, tx.to, tx.value, BigInt((tx.data.length - 2) / 2), tx.data]
  );
  return encoded.slice(2); // Remove 0x prefix for concatenation
}

/**
 * Encode multiple transactions for Safe multiSend.
 *
 * @param transactions - Array of transactions to encode
 * @returns Encoded calldata for multiSend function
 */
export function encodeMultiSend(transactions: SafeSimulationTransaction[]): Hex {
  const internals = transactions.map((tx) => ({
    data: tx.data,
    operation: tx.operation ?? 0,
    to: tx.to,
    value: tx.value,
  }));

  const packedData = `0x${internals.map(encodeInternalTransaction).join("")}` as Hex;

  return encodeFunctionData({
    abi: safeAbis.multiSend,
    args: [packedData],
    functionName: "multiSend",
  });
}

/**
 * Decode simulation revert data to extract gas estimate and success flag.
 *
 * Safe uses a custom encoding scheme for the revert data. The gas limit is the 3rd EVM word,
 * and success is the 4th one. Each word is 64 hex chars (32 bytes).
 *
 * IMPORTANT: This function may throw an error when the revert data is not due to a legitimate
 * response from `simulateAndRevert`.
 *
 * @param revertData - The revert data from simulateAndRevert call
 * @returns Gas estimate and success flag
 * @throws Error if revert data is too short to contain valid gas and success data
 */
export function decodeSimulationData(revertData: string): {
  gas: bigint;
  success: boolean;
} {
  // Gas estimate is at EVM word 3, success at word 4
  // Each word is 64 hex chars (32 bytes)
  // Total required: 0x prefix (2) + 128 chars (4 words) + 128 chars (2 words for gas and success) = 258 chars
  const minLength = 258;
  if (revertData.length < minLength) {
    throw new Error(
      `Invalid simulation data: revert data too short. Expected at least ${minLength} characters (${(minLength - 2) / 2} bytes), got ${revertData.length} characters (${Math.max(0, (revertData.length - 2) / 2)} bytes)`
    );
  }

  const gasAndSuccessData = revertData.slice(2).slice(128, 256);

  const decoded = decodeAbiParameters(
    [
      { name: "estimate", type: "uint256" },
      { name: "success", type: "bool" },
    ],
    `0x${gasAndSuccessData}` as Hex
  );

  return {
    gas: decoded[0],
    success: decoded[1],
  };
}
