/**
 * Test addresses and constants for effect-web3 test suite
 */

import { mainnet } from "viem/chains";

export const TEST_ADDRESS = "0x1234567890123456789012345678901234567890" as const;
export const TEST_ADDRESS_2 = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;
export const TEST_TX_HASH =
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as const;
export const TEST_CHAIN_ID = mainnet.id;
export const UNKNOWN_CHAIN_ID = 123_456_789;
