import { Layer } from "effect";
import type { BalanceService } from "#src/balance/index.js";
import { BalanceServiceLive } from "#src/balance/index.js";
import type { PdaService } from "#src/pda/index.js";
import { PdaServiceLive } from "#src/pda/index.js";
import type { RpcService } from "#src/rpc/index.js";
import type { SignerService } from "#src/signer/index.js";
import type { TokenService } from "#src/token/index.js";
import { TokenServiceLive } from "#src/token/index.js";
import type { TransactionService } from "#src/tx/index.js";
import { TransactionServiceLive } from "#src/tx/index.js";
import type { MockBalanceServiceConfig } from "./mock-balance-service.js";
import { makeMockBalanceServiceLayer } from "./mock-balance-service.js";
import type { MockPdaServiceConfig } from "./mock-pda-service.js";
import { makeMockPdaServiceLayer } from "./mock-pda-service.js";
import type { MockRpcServiceConfig } from "./mock-rpc-service.js";
import { makeMockRpcServiceLayer } from "./mock-rpc-service.js";
import type { MockSignerServiceConfig } from "./mock-signer-service.js";
import { makeMockSignerServiceLayer } from "./mock-signer-service.js";
import type { MockTokenServiceConfig } from "./mock-token-service.js";
import { makeMockTokenServiceLayer } from "./mock-token-service.js";
import type { MockTransactionServiceConfig } from "./mock-transaction-service.js";
import { makeMockTransactionServiceLayer } from "./mock-transaction-service.js";

/**
 * Configuration for the test layer composer
 *
 * @example
 * ```typescript
 * const layer = makeEffectSolanaTestLayer({
 *   rpcService: {
 *     getRpc: () => Effect.succeed(myMockRpc),
 *   },
 *   signerService: {
 *     address: "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK" as Address,
 *   },
 *   balanceService: {
 *     getSolBalance: () => Effect.succeed(5000000000n as Lamports),
 *   },
 * });
 * ```
 */
export type TestLayerConfig = {
  /**
   * Configuration overrides for the mock RpcService
   */
  rpcService?: MockRpcServiceConfig;

  /**
   * Configuration overrides for the mock SignerService
   */
  signerService?: MockSignerServiceConfig;

  /**
   * Configuration overrides for the mock BalanceService
   */
  balanceService?: MockBalanceServiceConfig;

  /**
   * Configuration overrides for the mock TokenService
   */
  tokenService?: MockTokenServiceConfig;

  /**
   * Configuration overrides for the mock TransactionService
   */
  transactionService?: MockTransactionServiceConfig;

  /**
   * Configuration overrides for the mock PdaService
   */
  pdaService?: MockPdaServiceConfig;
};

/**
 * Internal layer combining all application services
 * Requires RpcService and SignerService to be provided
 *
 * Layer composition order matters:
 * 1. Base services (directly client-bound, no service deps)
 * 2. Dependent services (require base services)
 */
const applicationServices = Layer.mergeAll(
  BalanceServiceLive,
  TokenServiceLive,
  TransactionServiceLive,
  PdaServiceLive
);

/**
 * Creates a complete effect-solana test layer with mocked boundaries
 *
 * This layer provides all effect-solana services with mocked RpcService
 * and SignerService boundaries. The mock boundaries use sensible defaults
 * that can be overridden via configuration.
 *
 * Use this for integration-style tests where you want real service implementations
 * with controlled network boundaries.
 *
 * @param config - Optional configuration to customize mock behaviors
 * @returns A Layer providing all effect-solana services
 *
 * @example
 * ```typescript
 * import { describe, expect, it } from "@effect/vitest";
 * import { Effect, Layer } from "effect";
 * import { BalanceService } from "@prb/effect-solana";
 * import { makeEffectSolanaTestLayer } from "@prb/effect-solana/testing-kit";
 *
 * describe("MyFeature", () => {
 *   const testLayer = makeEffectSolanaTestLayer({
 *     balanceService: {
 *       getSolBalance: () => Effect.succeed(1000000000n as Lamports),
 *     },
 *   });
 *
 *   it.effect("reads balance", () =>
 *     Effect.gen(function* () {
 *       const balanceService = yield* BalanceService;
 *       const balance = yield* balanceService.getSolBalance(address);
 *       expect(balance).toBe(1000000000n);
 *     }).pipe(Effect.provide(testLayer))
 *   );
 * });
 * ```
 */
export function makeEffectSolanaTestLayer(
  config: TestLayerConfig = {}
): Layer.Layer<
  RpcService | SignerService | BalanceService | TokenService | TransactionService | PdaService
> {
  // Create boundary mocks - use real services if no config provided
  const boundaryLayers = Layer.mergeAll(
    makeMockRpcServiceLayer(config.rpcService ?? {}),
    makeMockSignerServiceLayer(config.signerService ?? {})
  );

  // Create service mocks if config is provided, otherwise use real implementations from applicationServices
  let serviceMockLayer = Layer.empty;

  if (config.balanceService) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockBalanceServiceLayer(config.balanceService)
    );
  }
  if (config.tokenService) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockTokenServiceLayer(config.tokenService)
    );
  }
  if (config.transactionService) {
    serviceMockLayer = Layer.merge(
      serviceMockLayer,
      makeMockTransactionServiceLayer(config.transactionService)
    );
  }
  if (config.pdaService) {
    serviceMockLayer = Layer.merge(serviceMockLayer, makeMockPdaServiceLayer(config.pdaService));
  }

  // Provide boundary mocks and service mocks to application services
  const baseLayer = Layer.provideMerge(applicationServices, boundaryLayers);

  return Layer.merge(baseLayer, serviceMockLayer) as Layer.Layer<
    RpcService | SignerService | BalanceService | TokenService | TransactionService | PdaService
  >;
}
