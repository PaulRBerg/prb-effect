import type { Layer } from "effect";
import { Effect } from "effect";
import type { Address, Hex } from "viem";
import { MIN_TX_GAS } from "#src/constants/index.js";
import type { ClientNotFoundError } from "#src/core/index.js";
import type { FeeEstimate, GasPriceUnavailableError, GasSpeed } from "#src/gas/index.js";
import { GasService } from "#src/gas/index.js";
import { makeMockServiceLayer, withChainIdCheck } from "./helpers.js";

const DEFAULT_FEE_ESTIMATE: FeeEstimate = {
  confidence: 85,
  estimatedBaseFee: 30000000000n, // 30 gwei
  gasPrice: 45000000000n, // 45 gwei for legacy
  maxFeePerGas: 90000000000n, // 90 gwei
  maxPriorityFeePerGas: 1500000000n, // 1.5 gwei
};

const DEFAULT_ALL_FEE_ESTIMATES: Record<GasSpeed, FeeEstimate> = {
  fast: {
    confidence: 95,
    estimatedBaseFee: 30000000000n,
    gasPrice: 60000000000n,
    maxFeePerGas: 110000000000n,
    maxPriorityFeePerGas: 2500000000n,
  },
  instant: {
    confidence: 99,
    estimatedBaseFee: 30000000000n,
    gasPrice: 80000000000n,
    maxFeePerGas: 140000000000n,
    maxPriorityFeePerGas: 5000000000n,
  },
  slow: {
    confidence: 70,
    estimatedBaseFee: 30000000000n,
    gasPrice: 35000000000n,
    maxFeePerGas: 70000000000n,
    maxPriorityFeePerGas: 1000000000n,
  },
  standard: {
    confidence: 85,
    estimatedBaseFee: 30000000000n,
    gasPrice: 45000000000n,
    maxFeePerGas: 90000000000n,
    maxPriorityFeePerGas: 1500000000n,
  },
};

/**
 * Configuration for the mock GasService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockGasServiceConfig = {
  estimateFees?: (params: {
    chainId: number;
    speed?: GasSpeed;
  }) => Effect.Effect<FeeEstimate, GasPriceUnavailableError | ClientNotFoundError>;

  getAllFeeEstimates?: (params: {
    chainId: number;
  }) => Effect.Effect<
    Record<GasSpeed, FeeEstimate>,
    GasPriceUnavailableError | ClientNotFoundError
  >;

  getBaseFee?: (params: {
    chainId: number;
  }) => Effect.Effect<bigint, GasPriceUnavailableError | ClientNotFoundError>;

  getMaxPriorityFee?: (params: {
    chainId: number;
  }) => Effect.Effect<bigint, GasPriceUnavailableError | ClientNotFoundError>;

  estimateGas?: (params: {
    chainId: number;
    data?: Hex;
    from?: Address;
    to: Address;
    value?: bigint;
  }) => Effect.Effect<bigint, GasPriceUnavailableError | ClientNotFoundError>;

  estimateL1Fee?: (params: {
    chainId: number;
    data?: Hex;
    from?: Address;
    to: Address;
    value?: bigint;
  }) => Effect.Effect<bigint, GasPriceUnavailableError | ClientNotFoundError>;

  hasL1DataFee?: (params: { chainId: number }) => Effect.Effect<boolean, ClientNotFoundError>;

  supportsEip1559?: (params: {
    chainId: number;
  }) => Effect.Effect<boolean, GasPriceUnavailableError | ClientNotFoundError>;
};

const defaultConfig: Required<MockGasServiceConfig> = {
  estimateFees: () => Effect.succeed(DEFAULT_FEE_ESTIMATE),
  estimateGas: () => Effect.succeed(MIN_TX_GAS), // Standard transfer
  estimateL1Fee: () => Effect.succeed(0n),
  getAllFeeEstimates: () => Effect.succeed(DEFAULT_ALL_FEE_ESTIMATES),
  getBaseFee: () => Effect.succeed(30000000000n), // 30 gwei
  getMaxPriorityFee: () => Effect.succeed(1500000000n), // 1.5 gwei
  hasL1DataFee: () => Effect.succeed(false),
  supportsEip1559: () => Effect.succeed(true),
};

/**
 * Creates a mock GasService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainId - The chainId this mock supports (default: 1 mainnet)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockGasServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockGasServiceLayer({
 *   estimateFees: () => Effect.succeed({ maxFeePerGas: 100000000000n, ... }),
 *   supportsEip1559: () => Effect.succeed(false),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const gasService = yield* GasService;
 *   const fees = yield* gasService.estimateFees({ chainId: mainnet.id });
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockGasServiceLayer = (
  config: MockGasServiceConfig = {},
  supportedChainId = 1
): Layer.Layer<GasService> =>
  makeMockServiceLayer(GasService, defaultConfig, config, (merged) => ({
    estimateFees: withChainIdCheck(supportedChainId, merged.estimateFees),
    estimateGas: withChainIdCheck(supportedChainId, merged.estimateGas),
    estimateL1Fee: withChainIdCheck(supportedChainId, merged.estimateL1Fee),
    getAllFeeEstimates: withChainIdCheck(supportedChainId, merged.getAllFeeEstimates),
    getBaseFee: withChainIdCheck(supportedChainId, merged.getBaseFee),
    getMaxPriorityFee: withChainIdCheck(supportedChainId, merged.getMaxPriorityFee),
    hasL1DataFee: withChainIdCheck(supportedChainId, merged.hasL1DataFee),
    supportsEip1559: withChainIdCheck(supportedChainId, merged.supportsEip1559),
  }));
