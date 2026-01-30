import type { AccessList, TransactionType } from "viem";

/**
 * Fee overrides for a transaction.
 *
 * - Legacy: `gasPrice`
 * - EIP-1559: `maxFeePerGas` (+ optional `maxPriorityFeePerGas`)
 */
export type FeeOverrides =
  | {
      readonly gasPrice: bigint;
      readonly maxFeePerGas?: never;
      readonly maxPriorityFeePerGas?: never;
    }
  | {
      readonly gasPrice?: never;
      readonly maxFeePerGas: bigint;
      readonly maxPriorityFeePerGas?: bigint | undefined;
    };

/**
 * Safe transaction-level overrides that can be applied to contract writes/simulations.
 *
 * Intentionally excludes `to`/`data`/`from` (derived from the contract call + account).
 */
export type TxOverrides = {
  readonly accessList?: AccessList | undefined;
  readonly gas?: bigint | undefined;
  readonly gasPrice?: bigint | undefined;
  readonly maxFeePerGas?: bigint | undefined;
  readonly maxPriorityFeePerGas?: bigint | undefined;
  readonly nonce?: number | undefined;
  readonly type?: TransactionType | undefined;
};
