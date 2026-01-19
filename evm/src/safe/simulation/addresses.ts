/**
 * Safe contract addresses for gas simulation and multi-send operations.
 *
 * @see https://github.com/safe-global/safe-deployments/blob/main/src/assets/v1.4.1/multi_send_call_only.json
 * @see https://github.com/safe-global/safe-deployments/blob/main/src/assets/v1.4.1/simulate_tx_accessor.json
 */
import type { Address } from "viem";
import {
  abstract,
  arbitrum,
  avalanche,
  base,
  baseSepolia,
  berachain,
  blast,
  bsc,
  gnosis,
  lightlinkPhoenix,
  linea,
  mainnet,
  mode,
  monad,
  morph,
  optimism,
  polygon,
  scroll,
  sei,
  sepolia,
  sonic,
  unichainSepolia,
  xdc,
  zksync,
} from "viem/chains";

/**
 * Chain IDs for address resolution.
 * These are defined as constants for clarity and maintainability.
 */

/** Chains where Safe MultiSend is available (sourced from old-ui) */
const SAFE_MULTI_SEND_CHAIN_IDS = [
  abstract.id,
  arbitrum.id,
  avalanche.id,
  base.id,
  baseSepolia.id,
  berachain.id,
  blast.id,
  bsc.id,
  gnosis.id,
  lightlinkPhoenix.id,
  linea.id,
  mainnet.id,
  mode.id,
  monad.id,
  morph.id,
  optimism.id,
  polygon.id,
  scroll.id,
  sei.id,
  sepolia.id,
  sonic.id,
  unichainSepolia.id,
  xdc.id,
  zksync.id,
] as const;

/** ZK rollups with custom Safe deployments */
const ZK_ROLLUP_CHAIN_IDS = [abstract.id, zksync.id] as const;

/** Chains with custom (non-canonical) Safe deployments */
const CUSTOM_DEPLOYMENT_CHAIN_IDS = [lightlinkPhoenix.id, xdc.id] as const;

/**
 * Get the MultiSend contract address for a given chain.
 *
 * Returns undefined for chains where Safe is not deployed.
 */
export function getMultiSendAddress(chainId: number): Address | undefined {
  if (!SAFE_MULTI_SEND_CHAIN_IDS.includes(chainId as (typeof SAFE_MULTI_SEND_CHAIN_IDS)[number])) {
    return undefined;
  }

  // ZK rollups with custom deployments (Abstract, ZKsync)
  if (ZK_ROLLUP_CHAIN_IDS.includes(chainId as (typeof ZK_ROLLUP_CHAIN_IDS)[number])) {
    return "0xf220D3b4DFb23C4ade8C88E526C1353AbAcbC38F";
  }

  // Chains with custom deployments (Lightlink, XDC)
  if (
    CUSTOM_DEPLOYMENT_CHAIN_IDS.includes(chainId as (typeof CUSTOM_DEPLOYMENT_CHAIN_IDS)[number])
  ) {
    return "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D";
  }

  // Canonical deployment for all other chains
  return "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
}

/**
 * Get the SimulateAccessor contract address for a given chain.
 *
 * Returns undefined for chains where Safe is not deployed.
 */
export function getSimulateAccessorAddress(chainId: number): Address | undefined {
  if (!SAFE_MULTI_SEND_CHAIN_IDS.includes(chainId as (typeof SAFE_MULTI_SEND_CHAIN_IDS)[number])) {
    return undefined;
  }

  // ZK rollups with custom deployments (Abstract, ZKsync)
  if (ZK_ROLLUP_CHAIN_IDS.includes(chainId as (typeof ZK_ROLLUP_CHAIN_IDS)[number])) {
    return "0x4191E2e12E8BC5002424CE0c51f9947b02675a44";
  }

  // Chains with custom deployments (Lightlink, XDC)
  if (
    CUSTOM_DEPLOYMENT_CHAIN_IDS.includes(chainId as (typeof CUSTOM_DEPLOYMENT_CHAIN_IDS)[number])
  ) {
    return "0x59AD6735bCd8152B84860Cb256dD9e96b85F69Da";
  }

  // Canonical deployment for all other chains
  return "0x3d4BA2E0884aa488718476ca2FB8Efc291A46199";
}
