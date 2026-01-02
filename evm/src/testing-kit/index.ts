/**
 * Testing Kit for effect-evm
 *
 * This module exports mock builders and test utilities for downstream
 * consumers to easily test code that depends on effect-evm services.
 *
 * @example
 * ```typescript
 * import { makeEffectEvmTestLayer } from "effect-evm/testing-kit";
 *
 * const testLayer = makeEffectEvmTestLayer({
 *   publicClient: {
 *     readContract: async () => 1000n,
 *   },
 * });
 * ```
 */

// Fixtures
export {
  TEST_ADDRESS,
  TEST_ADDRESS_2,
  TEST_CHAIN_ID,
  TEST_TX_HASH,
  UNKNOWN_CHAIN_ID,
} from "./_fixtures/addresses.js";
export { makeTestReceipt, TEST_RECEIPT } from "./_fixtures/receipts.js";

// Test helpers
export {
  assertLeft,
  assertRight,
  expectTaggedFailure,
  makeChainIdGetter,
  makeWalletChainIdGetter,
  withChainIdCheck,
  withWalletChainIdCheck,
} from "./helpers.js";

export type { MockBalanceServiceConfig } from "./mock-balance-service.js";
export { makeMockBalanceServiceLayer } from "./mock-balance-service.js";
export type { MockBlockServiceConfig } from "./mock-block-service.js";
export { makeMockBlockServiceLayer } from "./mock-block-service.js";
export type { MockCrossChainReaderConfig } from "./mock-cross-chain-reader.js";
export { makeMockCrossChainReaderLayer } from "./mock-cross-chain-reader.js";
export type { MockDeployServiceConfig } from "./mock-deploy-service.js";
export { makeMockDeployServiceLayer } from "./mock-deploy-service.js";
export type { MockErc721ServiceConfig } from "./mock-erc721-service.js";
export { makeMockErc721ServiceLayer } from "./mock-erc721-service.js";
export type { MockGasServiceConfig } from "./mock-gas-service.js";
export { makeMockGasServiceLayer } from "./mock-gas-service.js";
export type { MockNonceServiceConfig } from "./mock-nonce-service.js";
export { makeMockNonceServiceLayer } from "./mock-nonce-service.js";
// Mock layer builders
export type { MockPublicClientConfig } from "./mock-public-client.js";
export { makeMockPublicClientLayer } from "./mock-public-client.js";
export type { MockSignatureServiceConfig } from "./mock-signature-service.js";
export { makeMockSignatureServiceLayer } from "./mock-signature-service.js";
export type { MockSimulationServiceConfig } from "./mock-simulation-service.js";
export { makeMockSimulationServiceLayer } from "./mock-simulation-service.js";
export type { MockSubscriptionServiceConfig } from "./mock-subscription-service.js";
export { makeMockSubscriptionServiceLayer } from "./mock-subscription-service.js";
export type { MockTransferServiceConfig } from "./mock-transfer-service.js";
export { makeMockTransferServiceLayer } from "./mock-transfer-service.js";
export type { MockWalletClientConfig } from "./mock-wallet-client.js";
export { makeMockWalletClientLayer } from "./mock-wallet-client.js";
export type { MockWalletProviderConfig } from "./mock-wallet-provider.js";
export { makeMockWalletProvider } from "./mock-wallet-provider.js";
// Test layer composer
export type { TestLayerConfig } from "./test-layer.js";
export { makeEffectEvmTestLayer } from "./test-layer.js";
