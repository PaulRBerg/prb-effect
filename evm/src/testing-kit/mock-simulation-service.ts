import type { Layer } from "effect";
import { Effect } from "effect";
import type { Abi, Address, Hex } from "viem";
import { MIN_TX_GAS } from "@/src/constants/index.js";
import { formatPercent } from "@/src/internal/index.js";
import type { SimulationResult, SimulationServiceShape } from "@/src/simulation/index.js";
import { SimulationService } from "@/src/simulation/index.js";
import { makeMockServiceLayer, withChainIdCheck } from "./helpers.js";

/**
 * Configuration for the mock SimulationService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockSimulationServiceConfig = {
  simulate?: (params: {
    chainId: number;
    from: Address;
    to: Address;
    data?: Hex;
    value?: bigint;
    gas?: bigint;
    blockNumber?: bigint;
  }) => Effect.Effect<SimulationResult>;

  simulateBundle?: (params: {
    chainId: number;
    transactions: Array<{
      from: Address;
      to: Address;
      data?: Hex;
      value?: bigint;
    }>;
    blockNumber?: bigint;
  }) => Effect.Effect<SimulationResult[]>;

  getReadableSummary?: (result: SimulationResult, abi?: Abi) => Effect.Effect<string>;
};

const DEFAULT_SIMULATION_RESULT: SimulationResult = {
  gasLimit: 30000000n,
  gasUsed: MIN_TX_GAS,
  logs: [],
  stateDiff: [],
  success: true,
  trace: [],
};

const defaultConfig: Required<MockSimulationServiceConfig> = {
  getReadableSummary: (result: SimulationResult) => {
    const status = result.success ? "✓ Success" : "✗ Failed";
    const gasPercent =
      result.gasLimit > 0n ? formatPercent(Number(result.gasUsed) / Number(result.gasLimit)) : "0%";
    return Effect.succeed(
      `Mock simulation summary:\nStatus: ${status}\nGas: ${result.gasUsed.toLocaleString()} / ${result.gasLimit.toLocaleString()} (${gasPercent})`
    );
  },
  simulate: () => Effect.succeed(DEFAULT_SIMULATION_RESULT),
  simulateBundle: (params) =>
    Effect.succeed(params.transactions.map(() => DEFAULT_SIMULATION_RESULT)),
};

/**
 * Creates a mock SimulationService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainId - The chainId this mock supports (default: 1 mainnet)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockSimulationServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockSimulationServiceLayer({
 *   simulate: () => Effect.succeed({
 *     success: true,
 *     gasUsed: 50000n,
 *     gasLimit: 100000n,
 *     logs: [],
 *     stateDiff: [],
 *   }),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const simService = yield* SimulationService;
 *   const result = yield* simService.simulate({ ... });
 * }).pipe(Effect.provide(layer));
 * ```
 */
export const makeMockSimulationServiceLayer = (
  config: MockSimulationServiceConfig = {},
  supportedChainId = 1
): Layer.Layer<SimulationService> =>
  makeMockServiceLayer(SimulationService, defaultConfig, config, (merged) => ({
    getReadableSummary: (result, abi) => merged.getReadableSummary(result, abi),
    // Cast to widen error type from ClientNotFoundError to TenderlyErrors
    simulate: withChainIdCheck(
      supportedChainId,
      merged.simulate
    ) as unknown as SimulationServiceShape["simulate"],
    simulateBundle: withChainIdCheck(
      supportedChainId,
      merged.simulateBundle
    ) as unknown as SimulationServiceShape["simulateBundle"],
  }));
