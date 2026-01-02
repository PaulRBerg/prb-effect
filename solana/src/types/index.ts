/**
 * Type definitions for Solana integration.
 *
 * Re-exports key types from @solana/kit and defines custom types.
 *
 * @module
 */

// =============================================================================
// Re-exports from @solana/kit
// =============================================================================

export type {
  Address,
  Commitment,
  Lamports,
  Signature,
  TransactionError,
} from "@solana/kit";
export type { TransactionSigner } from "@solana/signers";

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
