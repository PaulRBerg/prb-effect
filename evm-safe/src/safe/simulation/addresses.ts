/**
 * Safe contract addresses for gas simulation and multi-send operations.
 *
 * @see https://ethereum.stackexchange.com/q/168410/24693
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
  hyperEvm,
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

const DENERGY_CHAIN_ID = 369_369;

/**
 * Chain IDs for address resolution.
 * These are defined as constants for clarity and maintainability.
 */

/** Chains where Safe MultiSend is available */
const SUPPORTED_CHAIN_IDS = new Set<number>([
  abstract.id,
  arbitrum.id,
  avalanche.id,
  base.id,
  baseSepolia.id,
  berachain.id,
  blast.id,
  bsc.id,
  DENERGY_CHAIN_ID,
  gnosis.id,
  hyperEvm.id,
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
]);

/**
 * Contract addresses for Safe v1.4.1 deployments.
 */

/** Canonical MultiSendCallOnly address (most EVM chains) */
const CANONICAL_MULTI_SEND_ADDRESS: Address = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";

/** Canonical SimulateTxAccessor address (most EVM chains) */
const CANONICAL_SIMULATE_ACCESSOR_ADDRESS: Address = "0x3d4BA2E0884aa488718476ca2FB8Efc291A46199";

const CUSTOM_DEPLOYMENTS: Readonly<
  Record<
    number,
    {
      readonly multiSend: Address;
      readonly simulate: Address;
    }
  >
> = {
  // ZK rollups with custom deployments (Abstract, ZKsync)
  [abstract.id]: {
    multiSend: "0xf220D3b4DFb23C4ade8C88E526C1353AbAcbC38F",
    simulate: "0x4191E2e12E8BC5002424CE0c51f9947b02675a44",
  },
  [zksync.id]: {
    multiSend: "0xf220D3b4DFb23C4ade8C88E526C1353AbAcbC38F",
    simulate: "0x4191E2e12E8BC5002424CE0c51f9947b02675a44",
  },
  // Chains with custom deployments (Lightlink, XDC)
  [DENERGY_CHAIN_ID]: {
    multiSend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    simulate: "0x3d4BA2E0884aa488718476ca2FB8Efc291A46199",
  },
  [lightlinkPhoenix.id]: {
    multiSend: "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D",
    simulate: "0x59AD6735bCd8152B84860Cb256dD9e96b85F69Da",
  },
  [xdc.id]: {
    multiSend: "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D",
    simulate: "0x59AD6735bCd8152B84860Cb256dD9e96b85F69Da",
  },
};

/**
 * Get the MultiSend contract address for a given chain.
 *
 * Returns undefined for chains where Safe is not deployed.
 */
export function getMultiSendAddress(chainId: number): Address | undefined {
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
    return undefined;
  }

  return CUSTOM_DEPLOYMENTS[chainId]?.multiSend ?? CANONICAL_MULTI_SEND_ADDRESS;
}

/**
 * Get the SimulateAccessor contract address for a given chain.
 *
 * Returns undefined for chains where Safe is not deployed.
 */
export function getSimulateAccessorAddress(chainId: number): Address | undefined {
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
    return undefined;
  }

  return CUSTOM_DEPLOYMENTS[chainId]?.simulate ?? CANONICAL_SIMULATE_ACCESSOR_ADDRESS;
}
