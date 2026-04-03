import type { PublicClient } from "viem";

/**
 * Detect whether a client is configured for an OP Stack chain.
 */
export function isOpStackClient(client: PublicClient): boolean {
  return client.chain?.contracts?.gasPriceOracle != null;
}
