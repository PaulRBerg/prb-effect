import type { Rpc, RpcSubscriptions, SolanaRpcApi, SolanaRpcSubscriptionsApi } from "@solana/kit";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { Context, Effect, Layer } from "effect";
import { ConnectionNotFoundError } from "@/src/core/errors/index.js";
import type { Cluster, ClusterConfig } from "@/src/types/index.js";

/**
 * Shape of the RPC service for type inference.
 *
 * @category Services
 */
export type RpcServiceShape = {
  /**
   * Get the Solana RPC client for making RPC calls.
   */
  readonly getRpc: () => Effect.Effect<Rpc<SolanaRpcApi>>;

  /**
   * Get the Solana RPC subscriptions client for WebSocket subscriptions.
   */
  readonly getRpcSubscriptions: () => Effect.Effect<
    RpcSubscriptions<SolanaRpcSubscriptionsApi>,
    ConnectionNotFoundError
  >;

  /**
   * Get the current cluster.
   */
  readonly getCluster: () => Effect.Effect<Cluster>;

  /**
   * Get the RPC URL.
   */
  readonly getRpcUrl: () => Effect.Effect<string>;
};

/**
 * Service tag for RPC client.
 *
 * @category Services
 */
export class RpcService extends Context.Tag("esolana/RpcService")<RpcService, RpcServiceShape>() {}

/**
 * Create an RpcService layer from cluster configuration.
 *
 * @category Layers
 */
export const makeRpcServiceLive = (config: ClusterConfig) => {
  // Create RPC client once during layer construction
  const rpcClient = createSolanaRpc(config.rpcUrl);

  // Lazy initialization for WebSocket subscription client
  let rpcSubscriptionsClient: RpcSubscriptions<SolanaRpcSubscriptionsApi> | null = null;

  return Layer.succeed(
    RpcService,
    RpcService.of({
      getCluster: () => Effect.succeed(config.cluster),

      getRpc: () => Effect.succeed(rpcClient),

      getRpcSubscriptions: () => {
        const wsUrl = config.wsUrl;
        if (!wsUrl) {
          return Effect.fail(
            new ConnectionNotFoundError({
              cluster: config.cluster,
              message: `WebSocket URL not configured for cluster: ${config.cluster}`,
            })
          );
        }
        return Effect.sync(() => {
          if (!rpcSubscriptionsClient) {
            rpcSubscriptionsClient = createSolanaRpcSubscriptions(wsUrl);
          }
          return rpcSubscriptionsClient;
        });
      },

      getRpcUrl: () => Effect.succeed(config.rpcUrl),
    })
  );
};

/**
 * Default devnet configuration for development.
 *
 * @category Layers
 */
export const RpcServiceDevnet = makeRpcServiceLive({
  cluster: "devnet",
  rpcUrl: "https://api.devnet.solana.com",
  wsUrl: "wss://api.devnet.solana.com",
});
