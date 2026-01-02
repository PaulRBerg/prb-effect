import type { Rpc, RpcSubscriptions, SolanaRpcApi, SolanaRpcSubscriptionsApi } from "@solana/kit";
import type { Layer } from "effect";
import { Effect } from "effect";
import { ConnectionNotFoundError } from "@/src/core/errors/index.js";
import { RpcService } from "@/src/rpc/index.js";
import type { Cluster } from "@/src/types/index.js";
import { TEST_CLUSTER } from "./_fixtures/addresses.js";
import { makeMockServiceLayer } from "./helpers.js";

/**
 * Configuration for the mock RpcService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockRpcServiceConfig = {
  getRpc?: () => Effect.Effect<Rpc<SolanaRpcApi>>;
  getRpcSubscriptions?: () => Effect.Effect<
    RpcSubscriptions<SolanaRpcSubscriptionsApi>,
    ConnectionNotFoundError
  >;
  getCluster?: () => Effect.Effect<Cluster>;
  getRpcUrl?: () => Effect.Effect<string>;
};

/**
 * Create a minimal mock RPC client for testing.
 * This is a partial mock - only commonly used methods are stubbed.
 */
const createMockRpc = (): Rpc<SolanaRpcApi> =>
  ({
    getAccountInfo: () => ({
      send: () => Promise.resolve({ value: null }),
    }),
    getBalance: () => ({
      send: () => Promise.resolve({ value: 1000000000n }),
    }),
    getLatestBlockhash: () => ({
      send: () =>
        Promise.resolve({
          value: {
            blockhash: "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC" as never,
            lastValidBlockHeight: 1000n,
          },
        }),
    }),
    getSignatureStatuses: () => ({
      send: () =>
        Promise.resolve({
          value: [
            {
              confirmationStatus: "confirmed" as never,
              confirmations: 10,
              err: null,
              slot: 1000n,
            },
          ],
        }),
    }),
    getTokenAccountBalance: () => ({
      send: () =>
        Promise.resolve({
          value: {
            amount: "1000000000",
            decimals: 9,
            uiAmount: 1.0,
            uiAmountString: "1.0",
          },
        }),
    }),
    sendTransaction: () => ({
      send: () => Promise.resolve("mock-signature"),
    }),
    simulateTransaction: () => ({
      send: () =>
        Promise.resolve({
          value: {
            err: null,
            logs: [],
          },
        }),
    }),
  }) as never;

const defaultConfig: Required<MockRpcServiceConfig> = {
  getCluster: () => Effect.succeed(TEST_CLUSTER),
  getRpc: () => Effect.succeed(createMockRpc()),
  getRpcSubscriptions: () =>
    Effect.fail(
      new ConnectionNotFoundError({
        cluster: TEST_CLUSTER,
        message: "WebSocket not configured in mock",
      })
    ),
  getRpcUrl: () => Effect.succeed("https://api.devnet.solana.com"),
};

/**
 * Creates a mock RpcService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockRpcServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockRpcServiceLayer({
 *   getRpc: () => Effect.succeed(myCustomMockRpc),
 *   getCluster: () => Effect.succeed("mainnet-beta"),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const rpcService = yield* RpcService;
 *   const rpc = yield* rpcService.getRpc();
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockRpcServiceLayer = (
  config: MockRpcServiceConfig = {}
): Layer.Layer<RpcService> =>
  makeMockServiceLayer(RpcService, defaultConfig, config, (merged) => merged);
