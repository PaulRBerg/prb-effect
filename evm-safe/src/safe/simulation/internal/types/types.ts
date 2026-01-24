/**
 * Shared type definitions for Safe simulation internals.
 */
import type { Address, PublicClient } from "viem";

/**
 * Resolved Safe contract addresses required for simulation.
 */
export type SafeMultisigContracts = {
  readonly multiSendAddr: Address;
  readonly simulateAccessorAddr: Address;
};

/**
 * Decoded revert payload for simulateAndRevert.
 */
export type SimulationDecoded = {
  readonly gas: bigint;
  readonly success: boolean;
};

/**
 * Block type alias used by helpers to avoid re-deriving it everywhere.
 */
export type LatestBlock = Awaited<ReturnType<PublicClient["getBlock"]>>;
