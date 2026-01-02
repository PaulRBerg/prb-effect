import type { Config } from "@wagmi/core";
import { getPublicClient, getWalletClient } from "@wagmi/core";
import { Effect, Layer } from "effect";
import type { Address } from "viem";
import {
  ClientNotFoundError,
  PublicClientService,
  WalletClientService,
  WalletNotConnectedError,
  WrongNetworkError,
} from "@/src/core/index.js";
import { effectEvmServices } from "@/src/presets/index.js";
import {
  makeWalletProviderRefLive,
  WalletLifecycleFromProviderRefLive,
  WalletServiceFromProviderRefLive,
} from "@/src/wallet/index.js";

export type WagmiWalletClientOptions = {
  /**
   * Fixed account to request from wagmi when creating a WalletClient.
   *
   * If omitted, wagmi will use the current connector/account (if present).
   */
  readonly account?: Address;
};

export function makePublicClientLayerFromWagmi(config: Config): Layer.Layer<PublicClientService> {
  return Layer.succeed(PublicClientService, {
    get: (chainId) =>
      Effect.gen(function* () {
        const client = yield* Effect.try({
          catch: (cause) =>
            new ClientNotFoundError({
              chainId,
              message:
                cause instanceof Error ? cause.message : `No public client for chain ${chainId}`,
            }),
          try: () => getPublicClient(config, { chainId }),
        });

        if (!client) {
          return yield* Effect.fail(
            new ClientNotFoundError({
              chainId,
              message: `No public client found for chain ${chainId}`,
            })
          );
        }

        return client;
      }),
  });
}

export function makeWalletClientLayerFromWagmi(
  config: Config,
  options: WagmiWalletClientOptions = {}
): Layer.Layer<WalletClientService> {
  return Layer.succeed(WalletClientService, {
    get: (chainId) =>
      Effect.tryPromise({
        catch: (cause) =>
          new WalletNotConnectedError({
            chainId,
            message:
              cause instanceof Error
                ? cause.message
                : `No wallet client available for chain ${chainId}`,
          }),
        try: () => {
          const params = options.account ? { account: options.account, chainId } : { chainId };
          return getWalletClient(config, params);
        },
      }).pipe(
        Effect.flatMap((client) => {
          if (!client) {
            return Effect.fail(
              new WalletNotConnectedError({
                chainId,
                message: `No wallet client available for chain ${chainId}`,
              })
            );
          }

          return Effect.tryPromise({
            catch: () =>
              new WalletNotConnectedError({
                chainId,
                message: `Failed to read wallet chainId for ${chainId}`,
              }),
            try: () => client.getChainId(),
          }).pipe(
            Effect.flatMap((actualChainId) =>
              actualChainId === chainId
                ? Effect.succeed(client)
                : Effect.fail(
                    new WrongNetworkError({
                      actualChainId,
                      expectedChainId: chainId,
                      message: `Wallet is on chainId=${actualChainId} but expected chainId=${chainId}`,
                    })
                  )
            )
          );
        })
      ),
  });
}

export function makeEffectEvmLayerFromWagmi(
  config: Config,
  options: WagmiWalletClientOptions = {}
) {
  const clientLayers = Layer.mergeAll(
    makePublicClientLayerFromWagmi(config),
    makeWalletClientLayerFromWagmi(config, options)
  );

  return Layer.provideMerge(effectEvmServices, clientLayers);
}

/**
 * Like `makeEffectEvmLayerFromWagmi`, but also provides a dynamic `WalletProviderRef`
 * and wallet services derived from it.
 *
 * This is the recommended layer for frontends that want a stable Effect runtime
 * while the connected wallet/provider changes over time.
 *
 * Pair this with a React-side subscriber (e.g. via `watchAccount`) that updates
 * `WalletProviderRef`.
 */
export function makeEffectEvmLayerFromWagmiWithWalletProviderRef(
  config: Config,
  options: WagmiWalletClientOptions = {}
) {
  const clientLayers = Layer.mergeAll(
    makePublicClientLayerFromWagmi(config),
    makeWalletClientLayerFromWagmi(config, options)
  );

  const providerRefLayer = makeWalletProviderRefLive();

  const walletLayers = Layer.provideMerge(
    Layer.mergeAll(WalletServiceFromProviderRefLive, WalletLifecycleFromProviderRefLive),
    providerRefLayer
  );

  return Layer.provideMerge(
    Layer.mergeAll(effectEvmServices, walletLayers, providerRefLayer),
    clientLayers
  );
}
