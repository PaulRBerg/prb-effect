/**
 * Shared constants for Solana integration.
 *
 * @module
 */

import type { Address, Cluster } from "../types/index.js";

// =============================================================================
// Lamport Constants
// =============================================================================

/** Number of lamports per SOL (1 SOL = 1,000,000,000 lamports). */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

// =============================================================================
// Cluster Endpoints
// =============================================================================

/**
 * Default RPC endpoints for each Solana cluster.
 */
export const ClusterEndpoints: Record<Cluster, string> = {
  devnet: "https://api.devnet.solana.com",
  localnet: "http://localhost:8899",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  testnet: "https://api.testnet.solana.com",
};

// =============================================================================
// Common Program Addresses
// =============================================================================

/** System Program address. */
export const SYSTEM_PROGRAM_ADDRESS =
  "11111111111111111111111111111111" as Address<"11111111111111111111111111111111">;

/** SPL Token Program address. */
export const TOKEN_PROGRAM_ADDRESS =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">;

/** SPL Token-2022 Program address. */
export const TOKEN_2022_PROGRAM_ADDRESS =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address<"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb">;

/** Associated Token Account Program address. */
export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address<"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL">;

/** Compute Budget Program address. */
export const COMPUTE_BUDGET_PROGRAM_ADDRESS =
  "ComputeBudget111111111111111111111111111111" as Address<"ComputeBudget111111111111111111111111111111">;

/** Memo Program address. */
export const MEMO_PROGRAM_ADDRESS =
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address<"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr">;
