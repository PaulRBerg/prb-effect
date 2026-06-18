/**
 * Type definitions for Solana integration.
 *
 * Defines package-level aliases around @solana/web3.js types.
 *
 * @module
 */

import type { TransactionInstruction } from "@solana/web3.js";

export type {
  Commitment,
  Signer as TransactionSigner,
  Transaction,
  TransactionError,
  TransactionInstruction as Instruction,
  TransactionSignature as Signature,
  VersionedTransaction,
} from "@solana/web3.js";

/**
 * Base58-encoded Solana address.
 */
export type Address<TAddress extends string = string> = TAddress;

/**
 * Lamports represented as bigint at this package boundary.
 */
export type Lamports = bigint;

/**
 * Alias for web3.js transaction instructions.
 */
export type Web3Instruction = TransactionInstruction;

// =============================================================================
// Cluster Configuration
// =============================================================================

/**
 * Solana cluster environments.
 */
export type Cluster = "mainnet-beta" | "devnet" | "testnet" | "localnet";

/**
 * Configuration for a Solana cluster connection.
 */
export type ClusterConfig = {
  readonly cluster: Cluster;
  readonly rpcUrl: string;
  readonly wsUrl?: string;
};

// =============================================================================
// Custom Branded Types
// =============================================================================

/**
 * Microlamports (1 lamport = 1,000,000 microlamports).
 * Used for priority fees in compute budget instructions.
 */
export type Microlamports = bigint & { readonly _brand: "Microlamports" };
