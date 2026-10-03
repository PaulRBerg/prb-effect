import { FetchHttpClient } from "@effect/platform";
import { Layer } from "effect";
import { mainnet } from "viem/chains";
import type { BalanceService } from "#src/balance/index.js";
import { BalanceServiceLive } from "#src/balance/index.js";
import type { BlockService } from "#src/block/index.js";
import { BlockServiceLive } from "#src/block/index.js";
import type { ContractPipeline, ContractReader, ContractWriter } from "#src/contract/index.js";
import {
  ContractPipelineLive,
  ContractReaderLive,
  ContractWriterLive,
} from "#src/contract/index.js";
import type { PublicClientService, WalletClientService } from "#src/core/index.js";
import type { DeployService } from "#src/deploy/index.js";
import { DeployServiceLive } from "#src/deploy/index.js";
import type { EnsResolver } from "#src/ens/index.js";
import { EnsResolverLive } from "#src/ens/index.js";
import type { Erc721Service } from "#src/erc721/index.js";
import { Erc721ServiceLive } from "#src/erc721/index.js";
import type { EventStream, ReliableEventStream } from "#src/events/index.js";
import { EventStreamLive, ReliableEventStreamLive } from "#src/events/index.js";
import type { GasService } from "#src/gas/index.js";
import { GasServiceLive } from "#src/gas/index.js";
import type { NonceService } from "#src/nonce/index.js";
import { NonceServiceLive } from "#src/nonce/index.js";
import type { SignatureService } from "#src/signature/index.js";
import { SignatureServiceLive } from "#src/signature/index.js";
import type { SimulationService } from "#src/simulation/index.js";
import { SimulationServiceLive } from "#src/simulation/index.js";
import type { SubscriptionService } from "#src/subscriptions/index.js";
import { SubscriptionServiceLive } from "#src/subscriptions/index.js";
import type { MockBalanceServiceConfig } from "#src/testing-kit/mock-balance-service.js";
import { makeMockBalanceServiceLayer } from "#src/testing-kit/mock-balance-service.js";
import type { MockBlockServiceConfig } from "#src/testing-kit/mock-block-service.js";
import { makeMockBlockServiceLayer } from "#src/testing-kit/mock-block-service.js";
import type { MockDeployServiceConfig } from "#src/testing-kit/mock-deploy-service.js";
import { makeMockDeployServiceLayer } from "#src/testing-kit/mock-deploy-service.js";
import type { MockErc721ServiceConfig } from "#src/testing-kit/mock-erc721-service.js";
import { makeMockErc721ServiceLayer } from "#src/testing-kit/mock-erc721-service.js";
import type { MockGasServiceConfig } from "#src/testing-kit/mock-gas-service.js";
import { makeMockGasServiceLayer } from "#src/testing-kit/mock-gas-service.js";
import type { MockNonceServiceConfig } from "#src/testing-kit/mock-nonce-service.js";
import { makeMockNonceServiceLayer } from "#src/testing-kit/mock-nonce-service.js";
import type { MockPublicClientConfig } from "#src/testing-kit/mock-public-client.js";
import { makeMockPublicClientLayer } from "#src/testing-kit/mock-public-client.js";
import type { MockSignatureServiceConfig } from "#src/testing-kit/mock-signature-service.js";
import { makeMockSignatureServiceLayer } from "#src/testing-kit/mock-signature-service.js";
import type { MockSimulationServiceConfig } from "#src/testing-kit/mock-simulation-service.js";
import { makeMockSimulationServiceLayer } from "#src/testing-kit/mock-simulation-service.js";
import type { MockSubscriptionServiceConfig } from "#src/testing-kit/mock-subscription-service.js";
import { makeMockSubscriptionServiceLayer } from "#src/testing-kit/mock-subscription-service.js";
import type { MockWalletClientConfig } from "#src/testing-kit/mock-wallet-client.js";
import { makeMockWalletClientLayer } from "#src/testing-kit/mock-wallet-client.js";
import type { TxManager, TxReplacement } from "#src/tx/index.js";
import { TxManagerLive, TxReplacementLive } from "#src/tx/index.js";

/**
 * Configuration for the test layer composer
 *
 * @example
 * ```typescript
 * const layer = makeEffectEvmTestLayer({
 *   publicClient: {
 *     readContract: async () => 1000n,
 *     getEnsAddress: async () => "0x...",
 *   },
 *   walletClient: {
 *     writeContract: async () => "0xtxhash...",
 *   },
 *   erc721Service: {
 *     ownerOf: () => Effect.succeed("0x..." as Address),
 *   },
 * });
 * ```
 */
export type TestLayerConfig = {
  /**
   * Configuration overrides for the mock PublicClient
   */
  publicClient?: MockPublicClientConfig;

  /**
   * Configuration overrides for the mock WalletClient
   */
  walletClient?: MockWalletClientConfig;

  /**
   * Configuration overrides for the mock BalanceService
   */
  balanceService?: MockBalanceServiceConfig;

  /**
   * Configuration overrides for the mock BlockService
   */
  blockService?: MockBlockServiceConfig;

  /**
   * Configuration overrides for the mock Erc721Service
   */
  erc721Service?: MockErc721ServiceConfig;

  /**
   * Configuration overrides for the mock GasService
   */
  gasService?: MockGasServiceConfig;

  /**
   * Configuration overrides for the mock NonceService
   */
  nonceService?: MockNonceServiceConfig;

  /**
   * Configuration overrides for the mock SignatureService
   */
  signatureService?: MockSignatureServiceConfig;

  /**
   * Configuration overrides for the mock SubscriptionService
   */
  subscriptionService?: MockSubscriptionServiceConfig;

  /**
   * Configuration overrides for the mock DeployService
   */
  deployService?: MockDeployServiceConfig;

  /**
   * Configuration overrides for the mock SimulationService
   */
  simulationService?: MockSimulationServiceConfig;

  /**
   * The chainId to support (default: 1 mainnet)
   */
  chainId?: number;
};

/**
 * Creates a complete effect-evm test layer with mocked boundaries
 *
 * This layer provides all effect-evm services with mocked PublicClientService
 * and WalletClientService boundaries. The mock boundaries use sensible defaults
 * that can be overridden via configuration.
 *
 * Use this for integration-style tests where you want real service implementations
 * with controlled network boundaries.
 *
 * @param config - Optional configuration to customize mock behaviors
 * @returns A Layer providing all effect-evm services
 *
 * @example
 * ```typescript
 * import { describe, expect, it } from "@effect/vitest";
 * import { Effect, Layer } from "effect";
 * import { ContractReader } from "effect-evm";
 * import { makeEffectEvmTestLayer } from "effect-evm/testing-kit";
 *
 * describe("MyFeature", () => {
 *   const testLayer = makeEffectEvmTestLayer({
 *     publicClient: {
 *       readContract: async () => 1000n,
 *     },
 *   });
 *
 *   it.effect("reads contract value", () =>
 *     Effect.gen(function* () {
 *       const reader = yield* ContractReader;
 *       const result = yield* reader.read({ ... });
 *       expect(result).toBe(1000n);
 *     }).pipe(Effect.provide(testLayer))
 *   );
 * });
 * ```
 */
export function makeEffectEvmTestLayer(
  config: TestLayerConfig = {}
): Layer.Layer<
  | PublicClientService
  | WalletClientService
  | BalanceService
  | BlockService
  | ContractReader
  | ContractWriter
  | ContractPipeline
  | TxManager
  | TxReplacement
  | EventStream
  | ReliableEventStream
  | EnsResolver
  | Erc721Service
  | GasService
  | NonceService
  | SignatureService
  | SubscriptionService
  | DeployService
  | SimulationService
> {
  const chainId = config.chainId ?? mainnet.id;

  // All live services use the configured client boundaries.
  const clientLayers = Layer.mergeAll(
    makeMockPublicClientLayer(config.publicClient ?? {}, chainId),
    makeMockWalletClientLayer(config.walletClient ?? {}, chainId)
  );

  // Choose overrides before building dependents so they share the same service instances.
  const baseServices = Layer.mergeAll(
    config.blockService
      ? makeMockBlockServiceLayer(config.blockService, chainId)
      : BlockServiceLive,
    ContractReaderLive,
    ContractWriterLive,
    config.gasService ? makeMockGasServiceLayer(config.gasService, chainId) : GasServiceLive,
    config.nonceService
      ? makeMockNonceServiceLayer(config.nonceService, chainId)
      : NonceServiceLive,
    config.signatureService
      ? makeMockSignatureServiceLayer(config.signatureService)
      : SignatureServiceLive,
    config.subscriptionService
      ? makeMockSubscriptionServiceLayer(config.subscriptionService, chainId)
      : SubscriptionServiceLive,
    EventStreamLive,
    EnsResolverLive
  );

  const txServices = Layer.provideMerge(
    TxManagerLive,
    Layer.provideMerge(TxReplacementLive, baseServices)
  );

  const applicationServices = Layer.provideMerge(
    Layer.mergeAll(
      config.balanceService
        ? makeMockBalanceServiceLayer(config.balanceService, chainId)
        : BalanceServiceLive,
      ContractPipelineLive,
      config.deployService
        ? makeMockDeployServiceLayer(config.deployService, chainId)
        : DeployServiceLive,
      config.erc721Service
        ? makeMockErc721ServiceLayer(config.erc721Service, chainId)
        : Erc721ServiceLive,
      ReliableEventStreamLive,
      config.simulationService
        ? makeMockSimulationServiceLayer(config.simulationService, chainId)
        : SimulationServiceLive
    ),
    txServices
  ).pipe(Layer.provide(FetchHttpClient.layer));

  return Layer.provideMerge(applicationServices, clientLayers);
}
