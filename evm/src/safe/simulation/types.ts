/**
 * Type definitions for Safe multisig gas simulation operations.
 */
import type { Address, Hex } from "viem";

/** Safe transaction operation type */
export type SafeOperation = 0 | 1; // 0 = Call, 1 = DelegateCall

/** A single transaction in a Safe batch */
export type SafeMultisigSimulationTx = {
  data: Hex;
  operation?: SafeOperation;
  to: Address;
  value: bigint;
};

/** Parameters for simulating a Safe batch */
export type SafeMultisigSimulateBatchParams = {
  chainId: number;
  safeAddress: Address;
  transactions: SafeMultisigSimulationTx[];
  /** Optional transaction size limit in bytes (for ZK chains) */
  txSizeLimit?: number;
  /** Gas threshold as percentage of block gas limit (1-100, default 95) */
  gasThresholdPercent?: number;
};

/** Result of a successful Safe simulation */
export type SafeMultisigSimulationResult = {
  estimatedGas: bigint;
  success: boolean;
};
