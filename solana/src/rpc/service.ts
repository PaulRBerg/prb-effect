import { Connection } from "@solana/web3.js";
import { Context, Effect, Layer } from "effect";
import { ConnectionNotFoundError } from "#src/core/errors/index.js";
import type { Cluster, ClusterConfig } from "#src/types/index.js";

/**
 * Shape of the RPC service for type inference.
 *
 * @category Services
 */
export type RpcServiceShape = {
  /**
   * Get the Solana RPC client for making RPC calls.
   */
  readonly getRpc: () => Effect.Effect<Connection>;

  /**
   * Get a Solana Connection configured with a WebSocket endpoint.
   */
  readonly getRpcSubscriptions: () => Effect.Effect<Connection, ConnectionNotFoundError>;

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
export const makeRpcServiceLive = (config: ClusterConfig) =>
  Layer.effect(
    RpcService,
    Effect.gen(function* () {
      const rpcClient = new Connection(config.rpcUrl);

      const getCachedSubscriptions = yield* Effect.cachedFunction((wsUrl: string) =>
        Effect.sync(
          () =>
            new Connection(config.rpcUrl, {
              wsEndpoint: wsUrl,
            })
        )
      );

      return RpcService.of({
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
          return getCachedSubscriptions(wsUrl);
        },

        getRpcUrl: () => Effect.succeed(config.rpcUrl),
      });
    })
  );

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
