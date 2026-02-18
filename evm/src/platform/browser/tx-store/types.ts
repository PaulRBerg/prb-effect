import type { Hash } from "viem";

/**
 * Represents a transaction replacement event (cancellation, repricing, or replacement).
 */
export type TxReplacement = {
  /**
   * Unix timestamp (milliseconds) when the replacement occurred.
   */
  at: number;

  /**
   * The original transaction hash that was replaced.
   */
  oldHash: Hash;

  /**
   * The new transaction hash after replacement.
   */
  newHash: Hash;

  /**
   * The reason for the replacement.
   */
  reason: "cancelled" | "replaced" | "repriced";
};

/**
 * Optional metadata about transaction gas parameters.
 * Stored as decimal strings to support bigint serialization.
 */
export type PersistedTxMeta = {
  /**
   * Gas limit as decimal string.
   */
  gas?: string;

  /**
   * Gas price as decimal string (legacy transactions).
   */
  gasPrice?: string;

  /**
   * Max fee per gas as decimal string (EIP-1559 transactions).
   */
  maxFeePerGas?: string;

  /**
   * Max priority fee per gas as decimal string (EIP-1559 transactions).
   */
  maxPriorityFeePerGas?: string;

  /**
   * Transaction nonce as decimal string.
   */
  nonce?: string;

  /**
   * Transaction type as decimal string (0 = legacy, 2 = EIP-1559, etc.).
   */
  type?: string;
};

/**
 * Persisted transaction record stored in browser storage.
 * Tracks the full lifecycle of a transaction including replacements.
 */
export type PersistedTx = {
  /**
   * Unique identifier: `${chainId}:${rootHash}`
   */
  id: string;

  /**
   * Chain ID where the transaction was submitted.
   */
  chainId: number;

  /**
   * The first submitted transaction hash (never changes).
   */
  rootHash: Hash;

  /**
   * The current transaction hash (updated after replacements).
   */
  currentHash: Hash;

  /**
   * Current status of the transaction.
   */
  status: "submitted" | "pending" | "mined" | "failed";

  /**
   * Unix timestamp (milliseconds) when the transaction was first created.
   */
  createdAt: number;

  /**
   * Unix timestamp (milliseconds) when the transaction was last updated.
   */
  updatedAt: number;

  /**
   * History of transaction replacements.
   */
  replacements: TxReplacement[];

  /**
   * Optional transaction metadata (gas parameters, nonce, etc.).
   */
  txMeta?: PersistedTxMeta;

  /**
   * Recipient address.
   */
  to?: string;

  /**
   * Sender address.
   */
  from?: string;

  /**
   * Transaction value as decimal string.
   */
  value?: string;

  /**
   * Transaction calldata as hex string.
   */
  data?: string;

  /**
   * Human-readable description of the transaction.
   */
  description?: string;

  /**
   * User-defined tags for categorization.
   */
  tags?: string[];
};

export type TxStoreChange =
  | {
      readonly _tag: "upsert";
      readonly at: number;
      readonly next: PersistedTx;
      readonly previous: PersistedTx | null;
    }
  | {
      readonly _tag: "delete";
      readonly at: number;
      readonly id: string;
      readonly previous: PersistedTx | null;
    };

export function isInFlightPersistedTx(tx: PersistedTx): boolean {
  return tx.status === "submitted" || tx.status === "pending";
}

/**
 * Generate a unique transaction ID from chain ID and root hash.
 *
 * @param chainId - The chain ID
 * @param rootHash - The root transaction hash
 * @returns Transaction ID in format `${chainId}:${rootHash}`
 */
export function makeTxId(chainId: number, rootHash: Hash): string {
  return `${chainId}:${rootHash}`;
}
