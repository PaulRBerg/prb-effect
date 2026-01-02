/**
 * Testing Kit for effect-solana
 *
 * This module exports mock builders and test utilities for downstream
 * consumers to easily test code that depends on effect-solana services.
 *
 * @example
 * ```typescript
 * import { makeEffectSolanaTestLayer } from "@prb/effect-solana/testing-kit";
 *
 * const testLayer = makeEffectSolanaTestLayer({
 *   balanceService: {
 *     getSolBalance: () => Effect.succeed(1000000000n as Lamports),
 *   },
 * });
 * ```
 */

// Fixtures
export {
  TEST_ADDRESS,
  TEST_ADDRESS_2,
  TEST_CLUSTER,
  TEST_MINT,
  TEST_SIGNATURE,
  TEST_WALLET,
} from "./_fixtures/addresses.js";

// Test helpers
export { assertLeft, assertRight, expectTaggedFailure, makeMockServiceLayer } from "./helpers.js";
export type { MockBalanceServiceConfig } from "./mock-balance-service.js";
export { makeMockBalanceServiceLayer } from "./mock-balance-service.js";
export type { MockPdaServiceConfig } from "./mock-pda-service.js";
export { makeMockPdaServiceLayer } from "./mock-pda-service.js";
// Mock layer builders
export type { MockRpcServiceConfig } from "./mock-rpc-service.js";
export { makeMockRpc, makeMockRpcServiceLayer } from "./mock-rpc-service.js";
export type { MockSignerServiceConfig } from "./mock-signer-service.js";
export { makeMockSignerServiceLayer } from "./mock-signer-service.js";
export type { MockTokenServiceConfig } from "./mock-token-service.js";
export { makeMockTokenServiceLayer } from "./mock-token-service.js";
export type { MockTransactionServiceConfig } from "./mock-transaction-service.js";
export { makeMockTransactionServiceLayer } from "./mock-transaction-service.js";

// Test layer composer
export type { TestLayerConfig } from "./test-layer.js";
export { makeEffectSolanaTestLayer } from "./test-layer.js";
