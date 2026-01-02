import type { Transport } from "viem";
import { fallback, http } from "viem";
import { DEFAULT_REQUEST_TIMEOUT, DEFAULT_RETRY_DELAY } from "@/src/constants/index.js";

export type TransportConfig = {
  /** RPC URL */
  url: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Number of retries on failure */
  retryCount?: number;
  /** Delay between retries in milliseconds */
  retryDelay?: number;
};

export type HttpTransportOptions = Omit<TransportConfig, "url">;

/**
 * Create an HTTP transport with configurable retry behavior
 */
export function makeHttpTransport(config: TransportConfig): Transport {
  return http(config.url, {
    retryCount: config.retryCount ?? 3,
    retryDelay: config.retryDelay ?? DEFAULT_RETRY_DELAY,
    timeout: config.timeout ?? DEFAULT_REQUEST_TIMEOUT,
  });
}

/**
 * Create a fallback transport from multiple URLs
 */
export function makeFallbackTransport(
  urls: readonly string[],
  options: HttpTransportOptions = {}
): Transport {
  return fallback(urls.map((url) => makeHttpTransport({ url, ...options })));
}

/**
 * Create transports map for multiple chains
 */
export function makeChainTransports(
  chains: {
    chainId: number;
    rpcUrls: readonly string[];
    http?: HttpTransportOptions | undefined;
  }[]
): Record<number, Transport> {
  return chains.reduce(
    (acc, chain) => {
      acc[chain.chainId] = makeFallbackTransport(chain.rpcUrls, chain.http ?? {});
      return acc;
    },
    {} as Record<number, Transport>
  );
}
