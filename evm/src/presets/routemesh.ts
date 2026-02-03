import { Schema } from "effect";
import type { Chain, Transport } from "viem";

import type { ChainConfig } from "./layers.js";
import { makeFallbackTransport } from "./transports.js";

// === Constants ===

export const ROUTEMESH_BASE_URL = "https://lb.routeme.sh/rpc";

// === Types ===

/**
 * Configuration for a single chain using RouteMesh
 */
export type RouteMeshChainEntry = {
  readonly chainId: number;
  readonly chain: Chain;
};

/**
 * Full RouteMesh configuration with API key
 */
export type RouteMeshConfig = {
  readonly apiKey: string;
  readonly chains: readonly RouteMeshChainEntry[];
};

/**
 * Configuration for a chain with RouteMesh primary + optional fallback URLs
 */
export type RouteMeshFallbackChainEntry = RouteMeshChainEntry & {
  readonly fallbackUrls?: readonly string[];
};

// === Errors ===

export class RouteMeshApiKeyMissingError extends Schema.TaggedError<RouteMeshApiKeyMissingError>()(
  "RouteMeshApiKeyMissingError",
  {
    message: Schema.String,
  }
) {}

// === URL Generation ===

/**
 * Generate a RouteMesh RPC URL for a specific chain
 *
 * @example
 * ```ts
 * const url = routemeshUrl(1, "my-api-key");
 * // => "https://lb.routeme.sh/rpc/1/my-api-key"
 * ```
 */
export const routemeshUrl = (chainId: number, apiKey: string): string =>
  `${ROUTEMESH_BASE_URL}/${chainId}/${apiKey}`;

/**
 * Create a URL generator function for a specific chain.
 * Useful for deferred API key resolution.
 *
 * @example
 * ```ts
 * const mainnetRpc = routemeshRpc(1);
 * const url = mainnetRpc("my-api-key");
 * // => "https://lb.routeme.sh/rpc/1/my-api-key"
 * ```
 */
export const routemeshRpc =
  (chainId: number): ((apiKey: string) => string) =>
  (apiKey) =>
    routemeshUrl(chainId, apiKey);

// === ChainConfig Integration ===

/**
 * Convert RouteMesh configuration to ChainConfig array.
 * Primary integration point with existing layer factories.
 *
 * @example
 * ```ts
 * import { mainnet, arbitrum } from "viem/chains";
 * import { makePublicClientLayer, routemeshToChainConfigs } from "effect-evm";
 *
 * const configs = routemeshToChainConfigs({
 *   apiKey: "my-api-key",
 *   chains: [
 *     { chainId: mainnet.id, chain: mainnet },
 *     { chainId: arbitrum.id, chain: arbitrum },
 *   ],
 * });
 *
 * const layer = makePublicClientLayer(configs);
 * ```
 */
export const routemeshToChainConfigs = (config: RouteMeshConfig): ChainConfig[] =>
  config.chains.map((entry) => ({
    chain: entry.chain,
    chainId: entry.chainId,
    rpcUrls: [routemeshUrl(entry.chainId, config.apiKey)],
  }));

// === Fallback Composition ===

/**
 * Create fallback URLs combining RouteMesh with other providers.
 * RouteMesh URL is placed first (primary).
 *
 * @example
 * ```ts
 * import { mainnet } from "viem/chains";
 *
 * const urls = routemeshWithFallback(mainnet.id, "api-key", [
 *   "https://eth.llamarpc.com",
 *   "https://rpc.ankr.com/eth",
 * ]);
 * // => ["https://lb.routeme.sh/rpc/1/api-key", "https://eth.llamarpc.com", ...]
 * ```
 */
export const routemeshWithFallback = (
  chainId: number,
  apiKey: string,
  fallbackUrls: readonly string[]
): string[] => [routemeshUrl(chainId, apiKey), ...fallbackUrls];

/**
 * Create chain transports with RouteMesh as primary and optional fallbacks.
 *
 * @example
 * ```ts
 * import { mainnet, arbitrum } from "viem/chains";
 * import { makeRouteMeshTransports } from "effect-evm";
 *
 * const transports = makeRouteMeshTransports("my-api-key", [
 *   { chainId: mainnet.id, chain: mainnet, fallbackUrls: ["https://eth.llamarpc.com"] },
 *   { chainId: arbitrum.id, chain: arbitrum },
 * ]);
 *
 * // Use with viem directly
 * const client = createPublicClient({
 *   chain: mainnet,
 *   transport: transports[mainnet.id],
 * });
 * ```
 */
export const makeRouteMeshTransports = (
  apiKey: string,
  chains: readonly RouteMeshFallbackChainEntry[]
): Record<number, Transport> =>
  chains.reduce(
    (acc, entry) => {
      const urls = routemeshWithFallback(entry.chainId, apiKey, entry.fallbackUrls ?? []);
      acc[entry.chainId] = makeFallbackTransport(urls);
      return acc;
    },
    {} as Record<number, Transport>
  );
