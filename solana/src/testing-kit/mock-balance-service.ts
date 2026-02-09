import type { Address, Lamports } from "@solana/kit";
import type { Layer } from "effect";
import { Effect, Stream } from "effect";
import { BalanceService } from "#src/balance/index.js";
import type { RpcError } from "#src/core/errors/index.js";
import { makeMockServiceLayer } from "./helpers.js";

/**
 * Configuration for the mock BalanceService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockBalanceServiceConfig = {
  getSolBalance?: (address: Address) => Effect.Effect<Lamports, RpcError>;
  hasSufficientBalance?: (params: {
    address: Address;
    required: Lamports;
  }) => Effect.Effect<boolean, RpcError>;
  watchBalance?: (params: {
    address: Address;
    pollingInterval?: number;
  }) => Effect.Effect<Stream.Stream<Lamports, RpcError>>;
};

const defaultConfig: Required<MockBalanceServiceConfig> = {
  getSolBalance: () => Effect.succeed(1000000000n as Lamports), // 1 SOL
  hasSufficientBalance: () => Effect.succeed(true),
  watchBalance: () => Effect.succeed(Stream.make(1000000000n as Lamports)),
};

/**
 * Creates a mock BalanceService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockBalanceServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockBalanceServiceLayer({
 *   getSolBalance: () => Effect.succeed(5000000000n as Lamports), // 5 SOL
 *   hasSufficientBalance: () => Effect.succeed(false),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const balanceService = yield* BalanceService;
 *   const balance = yield* balanceService.getSolBalance(address);
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockBalanceServiceLayer = (
  config: MockBalanceServiceConfig = {}
): Layer.Layer<BalanceService> =>
  makeMockServiceLayer(BalanceService, defaultConfig, config, (merged) => merged);
