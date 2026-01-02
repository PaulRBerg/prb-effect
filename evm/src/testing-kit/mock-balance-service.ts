import type { Layer } from "effect";
import { Effect, Stream } from "effect";
import type { Address } from "viem";
import type { TokenBalance } from "@/src/balance/index.js";
import { BalanceService } from "@/src/balance/index.js";
import type {
  ClientNotFoundError,
  ContractReadError,
  MulticallError,
  TransportError,
} from "@/src/core/index.js";
import { makeMockServiceLayer, withChainIdCheck } from "./helpers.js";

/**
 * Configuration for the mock BalanceService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockBalanceServiceConfig = {
  getBalance?: (params: {
    chainId: number;
    address: Address;
    blockTag?: "latest" | "pending";
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  getTokenBalance?: (params: {
    chainId: number;
    address: Address;
    tokenAddress: Address;
  }) => Effect.Effect<bigint, ContractReadError | ClientNotFoundError>;

  getTokenBalances?: (params: {
    chainId: number;
    address: Address;
    tokenAddresses: Address[];
  }) => Effect.Effect<TokenBalance[], ClientNotFoundError | MulticallError>;

  watchBalance?: (params: {
    chainId: number;
    address: Address;
    pollingInterval?: number;
  }) => Effect.Effect<Stream.Stream<bigint, unknown>, ClientNotFoundError>;

  watchTokenBalance?: (params: {
    chainId: number;
    address: Address;
    tokenAddress: Address;
    pollingInterval?: number;
  }) => Effect.Effect<Stream.Stream<bigint, unknown>, ClientNotFoundError>;

  hasSufficientBalance?: (params: {
    chainId: number;
    address: Address;
    required: bigint;
  }) => Effect.Effect<boolean, ClientNotFoundError | TransportError>;

  hasSufficientTokenBalance?: (params: {
    chainId: number;
    address: Address;
    tokenAddress: Address;
    required: bigint;
  }) => Effect.Effect<boolean, ContractReadError | ClientNotFoundError>;
};

const defaultConfig: Required<MockBalanceServiceConfig> = {
  getBalance: () => Effect.succeed(1000000000000000000n), // 1 ETH
  getTokenBalance: () => Effect.succeed(1000000000n), // typical token balance
  getTokenBalances: (params: { tokenAddresses: Address[] }) =>
    Effect.succeed(
      params.tokenAddresses.map((address) => ({
        address,
        balance: 1000000000n,
        decimals: 18,
        name: "Mock Token",
        symbol: "MOCK",
      }))
    ),
  hasSufficientBalance: () => Effect.succeed(true),
  hasSufficientTokenBalance: () => Effect.succeed(true),
  watchBalance: () => Effect.succeed(Stream.make(1000000000000000000n)),
  watchTokenBalance: () => Effect.succeed(Stream.make(1000000000n)),
};

/**
 * Creates a mock BalanceService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainId - The chainId this mock supports (default: 1 mainnet)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockBalanceServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockBalanceServiceLayer({
 *   getBalance: () => Effect.succeed(5000000000000000000n), // 5 ETH
 *   getTokenBalance: () => Effect.succeed(1000000000000n),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const balanceService = yield* BalanceService;
 *   const balance = yield* balanceService.getBalance({
 *     chainId: mainnet.id,
 *     address: "0x...",
 *   });
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockBalanceServiceLayer = (
  config: MockBalanceServiceConfig = {},
  supportedChainId = 1
): Layer.Layer<BalanceService> =>
  makeMockServiceLayer(BalanceService, defaultConfig, config, (merged) => ({
    getBalance: withChainIdCheck(supportedChainId, merged.getBalance),
    getTokenBalance: withChainIdCheck(supportedChainId, merged.getTokenBalance),
    getTokenBalances: withChainIdCheck(supportedChainId, merged.getTokenBalances),
    hasSufficientBalance: withChainIdCheck(supportedChainId, merged.hasSufficientBalance),
    hasSufficientTokenBalance: withChainIdCheck(supportedChainId, merged.hasSufficientTokenBalance),
    watchBalance: withChainIdCheck(supportedChainId, merged.watchBalance),
    watchTokenBalance: withChainIdCheck(supportedChainId, merged.watchTokenBalance),
  }));
