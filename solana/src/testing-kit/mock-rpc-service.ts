import type { Rpc, RpcSubscriptions, SolanaRpcApi, SolanaRpcSubscriptionsApi } from "@solana/kit";
import { createSolanaRpc } from "@solana/kit";
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
 * Wraps a value with the standard RPC response context structure
 */
const wrapResponse = <T>(value: T) => ({ context: { slot: 0n }, value });

/**
 * Create a mock RPC client for testing.
 * Provides a full Rpc<SolanaRpcApi> via createSolanaRpc with safe overrides.
 *
 * Uses type assertion because Solana RPC types use many branded types (Lamports, Signature, etc.)
 * that cannot be created from literals. The mock values are structurally correct at runtime.
 */
export const makeMockRpc = (overrides: Partial<Rpc<SolanaRpcApi>> = {}): Rpc<SolanaRpcApi> =>
  ({
    ...createSolanaRpc("http://localhost"),
    getAccountInfo: () => ({
      send: () => Promise.resolve(wrapResponse(null)),
    }),
    getBalance: () => ({
      send: () => Promise.resolve(wrapResponse(1000000000n)),
    }),
    getLatestBlockhash: () => ({
      send: () =>
        Promise.resolve(
          wrapResponse({
            blockhash: "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC",
            lastValidBlockHeight: 1000n,
          })
        ),
    }),
    getSignatureStatuses: () => ({
      send: () =>
        Promise.resolve(
          wrapResponse([
            {
              confirmationStatus: "confirmed",
              confirmations: 10n,
              err: null,
              slot: 1000n,
              status: { Ok: null },
            },
          ])
        ),
    }),
    getTokenAccountBalance: () => ({
      send: () =>
        Promise.resolve(
          wrapResponse({
            amount: "1000000000",
            decimals: 9,
            uiAmount: 1.0,
            uiAmountString: "1.0",
          })
        ),
    }),
    sendTransaction: () => ({
      send: () => Promise.resolve("mock-signature"),
    }),
    simulateTransaction: () => ({
      send: () =>
        Promise.resolve(
          wrapResponse({
            err: null,
            logs: [] as string[],
            returnData: null,
          })
        ),
    }),
    ...overrides,
  }) as Rpc<SolanaRpcApi>;

const defaultConfig: Required<MockRpcServiceConfig> = {
  getCluster: () => Effect.succeed(TEST_CLUSTER),
  getRpc: () => Effect.succeed(makeMockRpc()),
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
