import type { Instruction } from "@solana/instructions";
import type { Signature } from "@solana/keys";
import type {
  TransactionMessage,
  TransactionMessageWithFeePayer,
  TransactionMessageWithLifetime,
} from "@solana/transaction-messages";
import type { Duration } from "effect";

/**
 * A transaction message shape that is ready to compile/sign/send.
 *
 * @category Types
 */
export type SignableTransactionMessage = TransactionMessage &
  TransactionMessageWithFeePayer &
  TransactionMessageWithLifetime;

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

  /**
   * Delay between confirmation polls.
   * @default "2 seconds"
   */
  readonly pollInterval?: Duration.DurationInput;

  /**
   * Whether to search transaction history outside the recent status cache.
   * @default true
   */
  readonly searchTransactionHistory?: boolean;

  /**
   * Optional blockhash lifetime metadata for detecting expiration while still
   * allowing a final status lookup grace period.
   */
  readonly lifetime?: {
    readonly blockhash: string;
    readonly lastValidBlockHeight: bigint;
    readonly expiredStatusGracePeriod?: Duration.DurationInput;
  };
};

/**
 * Options forwarded to a wallet-provider send path.
 *
 * @category Types
 */
export type WalletSendOpts = {
  /**
   * Number of retries for the RPC send path.
   */
  readonly maxRetries?: number;

  /**
   * Minimum context slot for preflight/send.
   */
  readonly minContextSlot?: number;

  /**
   * Commitment used for preflight simulation.
   */
  readonly preflightCommitment?: "processed" | "confirmed" | "finalized";

  /**
   * Whether wallet/provider send should skip preflight.
   */
  readonly skipPreflight?: boolean;
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
