/**
 * Transaction receipt fixtures for effect-evm test suite
 */

import type { TransactionReceipt } from "viem";
import { TEST_ADDRESS, TEST_TX_HASH } from "./addresses.js";

export const TEST_RECEIPT = {
  blockHash: "0x1234567890123456789012345678901234567890123456789012345678901234",
  blockNumber: 1000n,
  contractAddress: null,
  cumulativeGasUsed: 50000n,
  effectiveGasPrice: 1000000000n,
  from: TEST_ADDRESS,
  gasUsed: 50000n,
  logs: [],
  logsBloom: "0x00",
  status: "success",
  to: TEST_ADDRESS,
  transactionHash: TEST_TX_HASH,
  transactionIndex: 0,
  type: "eip1559",
} as const satisfies TransactionReceipt;

/**
 * Factory function to create test receipts with custom overrides
 *
 * @param overrides - Partial TransactionReceipt properties to override defaults
 * @returns A complete TransactionReceipt for testing
 *
 * @example
 * ```typescript
 * const receipt = makeTestReceipt({ status: "reverted", gasUsed: 100000n });
 * ```
 */
export const makeTestReceipt = (
  overrides: Partial<TransactionReceipt> = {}
): TransactionReceipt => ({
  ...TEST_RECEIPT,
  ...overrides,
});
