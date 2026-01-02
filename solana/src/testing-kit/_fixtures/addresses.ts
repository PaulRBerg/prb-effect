/**
 * Test addresses and constants for effect-solana test suite
 */

import type { Address, Signature } from "@solana/kit";

/**
 * Test address - System Program
 */
export const TEST_ADDRESS = "11111111111111111111111111111111" as Address;

/**
 * Test address 2 - Token Program
 */
export const TEST_ADDRESS_2 = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;

/**
 * Test signature
 */
export const TEST_SIGNATURE =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW" as Signature;

/**
 * Test cluster for mock services
 */
export const TEST_CLUSTER = "devnet" as const;

/**
 * Test mint address (USDC on devnet)
 */
export const TEST_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as Address;

/**
 * Test wallet address
 */
export const TEST_WALLET = "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK" as Address;
