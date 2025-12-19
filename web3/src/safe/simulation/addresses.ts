/**
 * Safe contract addresses for gas simulation and multi-send operations.
 *
 * @see https://github.com/safe-global/safe-deployments/blob/main/src/assets/v1.4.1/multi_send_call_only.json
 * @see https://github.com/safe-global/safe-deployments/blob/main/src/assets/v1.4.1/simulate_tx_accessor.json
 */
import type { Address } from "viem";

/**
 * Chain IDs for address resolution.
 * These are defined as constants for clarity and maintainability.
 */

/** ZK rollups with custom Safe deployments */
const ZK_ROLLUP_CHAIN_IDS = [
  2741, // Abstract
  324, // ZKsync
] as const;

/** Chains with custom (non-canonical) Safe deployments */
const CUSTOM_DEPLOYMENT_CHAIN_IDS = [
  1890, // Lightlink Phoenix
  50, // XDC
] as const;

/** Chains where Safe is not deployed */
const UNSUPPORTED_CHAIN_IDS = [
  88_888, // Chiliz
  1116, // CoreDAO
  50_104, // Sophon
  5330, // Superseed
  998, // HyperEVM
] as const;

/**
 * Get the MultiSend contract address for a given chain.
 *
 * Returns undefined for chains where Safe is not deployed.
 */
export function getMultiSendAddress(chainId: number): Address | undefined {
  // ZK rollups with custom deployments (Abstract, ZKsync)
  if (ZK_ROLLUP_CHAIN_IDS.includes(chainId as (typeof ZK_ROLLUP_CHAIN_IDS)[number])) {
    return "0xf220d3b4dfb23c4ade8c88e526c1353abacbc38f";
  }

  // Chains with custom deployments (Lightlink, XDC)
  if (
    CUSTOM_DEPLOYMENT_CHAIN_IDS.includes(chainId as (typeof CUSTOM_DEPLOYMENT_CHAIN_IDS)[number])
  ) {
    return "0x40a2accbd92bca938b02010e17a5b8929b49130d";
  }

  // Chains where Safe is not deployed (Chiliz, CoreDAO, Sophon, Superseed, Hyperevm)
  if (UNSUPPORTED_CHAIN_IDS.includes(chainId as (typeof UNSUPPORTED_CHAIN_IDS)[number])) {
    return undefined;
  }

  // Canonical deployment for all other chains
  return "0x9641d764fc13c8b624c04430c7356c1c7c8102e2";
}

/**
 * Get the SimulateAccessor contract address for a given chain.
 *
 * Returns undefined for chains where Safe is not deployed.
 */
export function getSimulateAccessorAddress(chainId: number): Address | undefined {
  // ZK rollups with custom deployments (Abstract, ZKsync)
  if (ZK_ROLLUP_CHAIN_IDS.includes(chainId as (typeof ZK_ROLLUP_CHAIN_IDS)[number])) {
    return "0x4191e2e12e8bc5002424ce0c51f9947b02675a44";
  }

  // Chains with custom deployments (Lightlink, XDC)
  if (
    CUSTOM_DEPLOYMENT_CHAIN_IDS.includes(chainId as (typeof CUSTOM_DEPLOYMENT_CHAIN_IDS)[number])
  ) {
    return "0x59ad6735bcd8152b84860cb256dd9e96b85f69da";
  }

  // Chains where Safe is not deployed (Chiliz, CoreDAO, Sophon, Superseed, Hyperevm)
  if (UNSUPPORTED_CHAIN_IDS.includes(chainId as (typeof UNSUPPORTED_CHAIN_IDS)[number])) {
    return undefined;
  }

  // Canonical deployment for all other chains
  return "0x3d4ba2e0884aa488718476ca2fb8efc291a46199";
}
