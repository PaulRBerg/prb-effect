import type { Instruction } from "@solana/instructions";
import type { Signature } from "@solana/keys";

/**
 * Options for confirming a transaction.
 *
 * @category Types
 */
export type ConfirmOpts = {
  /**
   * Commitment level for confirmation.
   * @default "confirmed"
   */
  readonly commitment?: "processed" | "confirmed" | "finalized";

  /**
   * Timeout in milliseconds for confirmation.
   * @default 60000 (60 seconds)
   */
  readonly timeout?: number;
};

/**
 * Compute budget configuration for transactions.
 *
 * @category Types
 */
export type ComputeBudgetConfig = {
  /**
   * Compute unit limit.
   */
  readonly unitLimit?: number;

  /**
   * Compute unit price in micro-lamports.
   */
  readonly microLamports?: number | bigint;
};

/**
 * Options for building a transaction.
 *
 * @category Types
 */
export type TransactionBuildOpts = {
  /**
   * Optional compute budget settings.
   */
  readonly computeBudget?: ComputeBudgetConfig;
};

/**
 * A batch item representing a transaction to build.
 *
 * @category Types
 */
export type TransactionBatchItem = {
  /**
   * Transaction instructions.
   */
  readonly instructions: readonly Instruction[];

  /**
   * Optional compute budget settings.
   */
  readonly computeBudget?: ComputeBudgetConfig;
};

/**
 * Options for batch transaction orchestration.
 *
 * @category Types
 */
export type TransactionBatchOpts = {
  /**
   * Concurrency for sending/confirming transactions.
   * @default 1 (sequential)
   */
  readonly concurrency?: number;

  /**
   * Retry count for send failures.
   * @default 0
   */
  readonly sendRetries?: number;

  /**
   * Delay between send retries in milliseconds.
   * @default 500
   */
  readonly sendRetryDelay?: number;

  /**
   * Confirmation options for each transaction.
   */
  readonly confirm?: ConfirmOpts;
};

/**
 * Receipt returned after a transaction is confirmed.
 *
 * @category Types
 */
export type TransactionReceipt = {
  /**
   * The transaction signature.
   */
  readonly signature: Signature;

  /**
   * The slot at which the transaction was confirmed.
   */
  readonly slot: bigint;

  /**
   * Number of confirmations. Null if not yet finalized.
   */
  readonly confirmations: bigint | null;
};
