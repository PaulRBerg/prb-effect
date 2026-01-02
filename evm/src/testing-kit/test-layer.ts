import { FetchHttpClient } from "@effect/platform";
import { Layer } from "effect";
import { mainnet } from "viem/chains";
import type { BalanceService } from "@/src/balance/index.js";
import { BalanceServiceLive } from "@/src/balance/index.js";
import type { BlockService } from "@/src/block/index.js";
import { BlockServiceLive } from "@/src/block/index.js";
import type { ContractPipeline, ContractReader, ContractWriter } from "@/src/contract/index.js";
import {
  ContractPipelineLive,
  ContractReaderLive,
  ContractWriterLive,
} from "@/src/contract/index.js";
import type { PublicClientService, WalletClientService } from "@/src/core/index.js";
import type { DeployService } from "@/src/deploy/index.js";
import { DeployServiceLive } from "@/src/deploy/index.js";
import type { EnsResolver } from "@/src/ens/index.js";
import { EnsResolverLive } from "@/src/ens/index.js";
import type { Erc721Service } from "@/src/erc721/index.js";
import { Erc721ServiceLive } from "@/src/erc721/index.js";
import type { EventStream, ReliableEventStream } from "@/src/events/index.js";
import { EventStreamLive, ReliableEventStreamLive } from "@/src/events/index.js";
import type { GasService } from "@/src/gas/index.js";
import { GasServiceLive } from "@/src/gas/index.js";
import type { NonceService } from "@/src/nonce/index.js";
import { NonceServiceLive } from "@/src/nonce/index.js";
import type { SignatureService } from "@/src/signature/index.js";
import { SignatureServiceLive } from "@/src/signature/index.js";
import type { SimulationService } from "@/src/simulation/index.js";
import { SimulationServiceLive } from "@/src/simulation/index.js";
import type { SubscriptionService } from "@/src/subscriptions/index.js";
import { SubscriptionServiceLive } from "@/src/subscriptions/index.js";
import type { MockBalanceServiceConfig } from "@/src/testing-kit/mock-balance-service.js";
import { makeMockBalanceServiceLayer } from "@/src/testing-kit/mock-balance-service.js";
import type { MockBlockServiceConfig } from "@/src/testing-kit/mock-block-service.js";
import { makeMockBlockServiceLayer } from "@/src/testing-kit/mock-block-service.js";
import type { MockDeployServiceConfig } from "@/src/testing-kit/mock-deploy-service.js";
import { makeMockDeployServiceLayer } from "@/src/testing-kit/mock-deploy-service.js";
import type { MockErc721ServiceConfig } from "@/src/testing-kit/mock-erc721-service.js";
import { makeMockErc721ServiceLayer } from "@/src/testing-kit/mock-erc721-service.js";
import type { MockGasServiceConfig } from "@/src/testing-kit/mock-gas-service.js";
import { makeMockGasServiceLayer } from "@/src/testing-kit/mock-gas-service.js";
import type { MockNonceServiceConfig } from "@/src/testing-kit/mock-nonce-service.js";
import { makeMockNonceServiceLayer } from "@/src/testing-kit/mock-nonce-service.js";
import type { MockPublicClientConfig } from "@/src/testing-kit/mock-public-client.js";
import { makeMockPublicClientLayer } from "@/src/testing-kit/mock-public-client.js";
import type { MockSignatureServiceConfig } from "@/src/testing-kit/mock-signature-service.js";
import { makeMockSignatureServiceLayer } from "@/src/testing-kit/mock-signature-service.js";
import type { MockSimulationServiceConfig } from "@/src/testing-kit/mock-simulation-service.js";
import { makeMockSimulationServiceLayer } from "@/src/testing-kit/mock-simulation-service.js";
import type { MockSubscriptionServiceConfig } from "@/src/testing-kit/mock-subscription-service.js";
import { makeMockSubscriptionServiceLayer } from "@/src/testing-kit/mock-subscription-service.js";
import type { MockWalletClientConfig } from "@/src/testing-kit/mock-wallet-client.js";
import { makeMockWalletClientLayer } from "@/src/testing-kit/mock-wallet-client.js";
import type { TxManager, TxReplacement } from "@/src/tx/index.js";
import { TxManagerLive, TxReplacementLive } from "@/src/tx/index.js";

/**
 * Configuration for the test layer composer
 *
 * @example
 * ```typescript
 * const layer = makeEffectWeb3TestLayer({
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
 * Internal layer combining all application services
 * Requires PublicClientService and WalletClientService to be provided
 *
 * Layer composition order matters:
 * 1. Base services (directly client-bound, no service deps)
 * 2. Dependent services (require base services, e.g. Balance uses ContractReader, Deploy uses TxManager)
 * 3. High-level services (ContractPipeline, ReliableEventStream, Simulation)
 */
const baseServices = Layer.mergeAll(
  BlockServiceLive,
  ContractReaderLive,
  ContractWriterLive,
  GasServiceLive,
  NonceServiceLive,
  SignatureServiceLive,
  SubscriptionServiceLive,
  EventStreamLive,
  EnsResolverLive
);

const txServices = Layer.provideMerge(
  TxManagerLive,
  Layer.provideMerge(TxReplacementLive, baseServices)
);

const applicationServices = Layer.provideMerge(
  Layer.mergeAll(
    BalanceServiceLive,
    ContractPipelineLive,
    DeployServiceLive,
    Erc721ServiceLive,
    ReliableEventStreamLive,
    SimulationServiceLive
  ),
  txServices
).pipe(Layer.provide(FetchHttpClient.layer));

/**
 * Creates a complete effect-web3 test layer with mocked boundaries
 *
 * This layer provides all effect-web3 services with mocked PublicClientService
 * and WalletClientService boundaries. The mock boundaries use sensible defaults
 * that can be overridden via configuration.
 *
 * Use this for integration-style tests where you want real service implementations
 * with controlled network boundaries.
 *
 * @param config - Optional configuration to customize mock behaviors
 * @returns A Layer providing all effect-web3 services
 *
 * @example
 * ```typescript
 * import { describe, expect, it } from "@effect/vitest";
 * import { Effect, Layer } from "effect";
 * import { ContractReader } from "effect-web3";
 * import { makeEffectWeb3TestLayer } from "effect-web3/testing-kit";
 *
 * describe("MyFeature", () => {
 *   const testLayer = makeEffectWeb3TestLayer({
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
export function makeEffectWeb3TestLayer(
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

  // Create boundary mocks - use real services if no config provided
  const clientLayers = Layer.mergeAll(
    makeMockPublicClientLayer(config.publicClient ?? {}, chainId),
    makeMockWalletClientLayer(config.walletClient ?? {}, chainId)
  );

  // Create service mocks if config is provided, otherwise use real implementations from applicationServices
  let serviceMockLayer = Layer.empty;

  if (config.balanceService) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockBalanceServiceLayer(config.balanceService, chainId)
    );
  }
  if (config.blockService) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockBlockServiceLayer(config.blockService, chainId)
    );
  }
  if (config.erc721Service) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockErc721ServiceLayer(config.erc721Service, chainId)
    );
  }
  if (config.gasService) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockGasServiceLayer(config.gasService, chainId)
    );
  }
  if (config.nonceService) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockNonceServiceLayer(config.nonceService, chainId)
    );
  }
  if (config.signatureService) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockSignatureServiceLayer(config.signatureService)
    );
  }
  if (config.subscriptionService) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockSubscriptionServiceLayer(config.subscriptionService, chainId)
    );
  }
  if (config.deployService) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockDeployServiceLayer(config.deployService, chainId)
    );
  }
  if (config.simulationService) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockSimulationServiceLayer(config.simulationService, chainId)
    );
  }

  // Provide boundary mocks and service mocks to application services
  const baseLayer = Layer.provideMerge(applicationServices, clientLayers);

  return Layer.merge(baseLayer, serviceMockLayer) as Layer.Layer<
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
  >;
}
