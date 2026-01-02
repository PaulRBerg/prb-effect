import type { Layer } from "effect";
import { Effect, Stream, SubscriptionRef } from "effect";
import type { Address, Block, Hash, Hex, Log } from "viem";
import { ClientNotFoundError } from "@/src/core/index.js";
import type {
  SubscriptionConnectionState,
  SubscriptionRetryConfig,
} from "@/src/subscriptions/index.js";
import { SubscriptionService } from "@/src/subscriptions/index.js";
import { makeMockServiceLayer, withChainIdCheck } from "./helpers.js";

/**
 * Configuration for the mock SubscriptionService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockSubscriptionServiceConfig = {
  watchBlocks?: (params: {
    chainId: number;
    includeTransactions?: boolean;
    pollingInterval?: number;
  }) => Effect.Effect<Stream.Stream<Block, never>>;

  watchLogs?: (params: {
    chainId: number;
    address?: Address | Address[];
    topics?: (Hex | Hex[] | null)[];
    pollingInterval?: number;
  }) => Effect.Effect<Stream.Stream<Log, never>>;

  watchPendingTransactions?: (params: {
    chainId: number;
    pollingInterval?: number;
  }) => Effect.Effect<Stream.Stream<Hash, never>>;

  watchBlocksRetrying?: (params: {
    chainId: number;
    includeTransactions?: boolean;
    pollingInterval?: number;
    retry?: SubscriptionRetryConfig;
  }) => Effect.Effect<{
    stateRef: SubscriptionRef.SubscriptionRef<SubscriptionConnectionState>;
    stream: Stream.Stream<Block, never>;
  }>;

  watchLogsRetrying?: (params: {
    chainId: number;
    address?: Address | Address[];
    topics?: (Hex | Hex[] | null)[];
    pollingInterval?: number;
    retry?: SubscriptionRetryConfig;
  }) => Effect.Effect<{
    stateRef: SubscriptionRef.SubscriptionRef<SubscriptionConnectionState>;
    stream: Stream.Stream<Log, never>;
  }>;

  watchPendingTransactionsRetrying?: (params: {
    chainId: number;
    pollingInterval?: number;
    retry?: SubscriptionRetryConfig;
  }) => Effect.Effect<{
    stateRef: SubscriptionRef.SubscriptionRef<SubscriptionConnectionState>;
    stream: Stream.Stream<Hash, never>;
  }>;

  hasWebSocket?: (chainId: number) => Effect.Effect<boolean>;
};

const defaultConfig: Required<MockSubscriptionServiceConfig> = {
  hasWebSocket: () => Effect.succeed(false),
  watchBlocks: () => Effect.succeed(Stream.empty),
  watchBlocksRetrying: (params) =>
    Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make<SubscriptionConnectionState>({
        status: "connected",
      });
      const { retry: _retry, ...watchParams } = params;
      const stream = yield* defaultConfig.watchBlocks(watchParams);
      return { stateRef, stream };
    }),
  watchLogs: () => Effect.succeed(Stream.empty),
  watchLogsRetrying: (params) =>
    Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make<SubscriptionConnectionState>({
        status: "connected",
      });
      const { retry: _retry, ...watchParams } = params;
      const stream = yield* defaultConfig.watchLogs(watchParams);
      return { stateRef, stream };
    }),
  watchPendingTransactions: () => Effect.succeed(Stream.empty),
  watchPendingTransactionsRetrying: (params) =>
    Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make<SubscriptionConnectionState>({
        status: "connected",
      });
      const { retry: _retry, ...watchParams } = params;
      const stream = yield* defaultConfig.watchPendingTransactions(watchParams);
      return { stateRef, stream };
    }),
};

/**
 * Creates a mock SubscriptionService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainId - The chainId this mock supports (default: 1 mainnet)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockSubscriptionServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockSubscriptionServiceLayer({
 *   watchBlocks: () => Effect.succeed(Stream.make({ number: 1000n })),
 *   hasWebSocket: () => Effect.succeed(true),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const subscriptions = yield* SubscriptionService;
 *   const blockStream = yield* subscriptions.watchBlocks({ chainId: mainnet.id });
 * }).pipe(Effect.provide(layer));
 * ```
 */
export const makeMockSubscriptionServiceLayer = (
  config: MockSubscriptionServiceConfig = {},
  supportedChainId = 1
): Layer.Layer<SubscriptionService> =>
  makeMockServiceLayer(SubscriptionService, defaultConfig, config, (merged) => ({
    // hasWebSocket takes chainId directly (not a params object), so we handle it separately
    hasWebSocket: (chainId) =>
      chainId === supportedChainId
        ? merged.hasWebSocket(chainId)
        : Effect.fail(
            new ClientNotFoundError({
              chainId,
              message: `No client configured for chain ID ${chainId}`,
            })
          ),

    // Methods that take params with chainId - use the helper
    watchBlocks: withChainIdCheck(supportedChainId, merged.watchBlocks),
    watchBlocksRetrying: withChainIdCheck(supportedChainId, merged.watchBlocksRetrying),
    watchLogs: withChainIdCheck(supportedChainId, merged.watchLogs),
    watchLogsRetrying: withChainIdCheck(supportedChainId, merged.watchLogsRetrying),
    watchPendingTransactions: withChainIdCheck(supportedChainId, merged.watchPendingTransactions),
    watchPendingTransactionsRetrying: withChainIdCheck(
      supportedChainId,
      merged.watchPendingTransactionsRetrying
    ),
  }));
