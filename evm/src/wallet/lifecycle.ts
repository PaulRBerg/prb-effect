import { Context, Effect, Layer, Option } from "effect";
import type { Address } from "viem";
import type { UserRejectedError } from "#src/core/index.js";
import { classifyWalletError } from "#src/core/index.js";
import { parseHexInt } from "#src/internal/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import type {
  AddChainParams,
  ChainSwitchError,
  WalletProvider,
  WatchAssetParams,
} from "#src/wallet/index.js";
import {
  AccountNotConnectedError,
  AddChainError,
  ChainSwitchError as ChainSwitchErrorClass,
  WalletConnectionError,
  WalletProviderRef,
  WatchAssetError,
} from "#src/wallet/index.js";

const UNKNOWN_CHAIN_ID = 0;

/**
 * Service for wallet lifecycle operations (connect, disconnect, chain management)
 */
export type WalletLifecycleShape = {
  readonly connect: () => Effect.Effect<Address[], WalletConnectionError | UserRejectedError>;
  readonly disconnect: () => Effect.Effect<void, never>;
  readonly isConnected: Effect.Effect<boolean, never>;
  readonly switchChain: (
    chainId: number
  ) => Effect.Effect<void, ChainSwitchError | UserRejectedError>;
  readonly addChain: (
    chain: AddChainParams
  ) => Effect.Effect<void, AddChainError | UserRejectedError>;
  readonly getChainId: () => Effect.Effect<number, AccountNotConnectedError>;
  readonly watchAsset: (
    params: WatchAssetParams
  ) => Effect.Effect<boolean, WatchAssetError | UserRejectedError>;
};

export class WalletLifecycle extends Context.Service<WalletLifecycle, WalletLifecycleShape>()(
  "ew3/WalletLifecycle"
) {}

/**
 * Create a live implementation of WalletLifecycle
 */
export function makeWalletLifecycleLive(provider: WalletProvider): Layer.Layer<WalletLifecycle> {
  return Layer.succeed(WalletLifecycle, {
    isConnected: Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        provider
          .request({
            method: "eth_accounts",
          })
          .then((accountsResult) => accountsResult as Address[])
          .catch(() => [] as Address[])
      );

      return result.length > 0;
    }),
    addChain: (chain: AddChainParams) =>
      Effect.gen(function* () {
        // Convert chain config to EIP-3085 format
        const chainIdHex = `0x${chain.id.toString(16)}`;

        const params = {
          blockExplorerUrls: chain.blockExplorerUrls,
          chainId: chainIdHex,
          chainName: chain.name,
          iconUrls: chain.iconUrls,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls?.http ?? [],
        };

        yield* Effect.tryPromise({
          catch: (error) => classifyWalletError(error, "addChain", { chainId: chain.id }),
          try: async () => {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [params],
            });
          },
        });
      }),
    connect: () =>
      Effect.gen(function* () {
        const accounts = yield* Effect.tryPromise({
          catch: (error) => classifyWalletError(error, "connect"),
          try: async () => {
            const result = await provider.request({
              method: "eth_requestAccounts",
            });
            return result as Address[];
          },
        });

        if (accounts.length === 0) {
          return yield* Effect.fail(
            new WalletConnectionError({
              message: "No accounts returned from wallet",
            })
          );
        }

        return accounts;
      }).pipe(Effect.withSpan(SpanNames.WALLET_CONNECT)),

    disconnect: () =>
      Effect.sync(() => {
        // Note: Most wallets don't support programmatic disconnect via EIP-1193
        // This is a no-op that represents the intent to disconnect
        // Applications should handle UI state separately
      }),

    getChainId: () =>
      Effect.gen(function* () {
        const chainIdHex = yield* Effect.tryPromise({
          catch: (error) =>
            new AccountNotConnectedError({
              message: error instanceof Error ? error.message : "Failed to get chain ID",
            }),
          try: async () => {
            const result = await provider.request({
              method: "eth_chainId",
            });
            return result as string;
          },
        });

        return Option.getOrElse(parseHexInt(chainIdHex), () => UNKNOWN_CHAIN_ID);
      }),

    switchChain: (chainId: number) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          catch: (error) => classifyWalletError(error, "switchChain", { chainId }),
          try: async () => {
            await provider.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: `0x${chainId.toString(16)}` }],
            });
          },
        });
      }).pipe(
        Effect.withSpan("ew3.wallet.switchChain", {
          attributes: {
            chainId,
          },
        })
      ),

    watchAsset: (params: WatchAssetParams) =>
      Effect.gen(function* () {
        return yield* Effect.tryPromise({
          catch: (error) => classifyWalletError(error, "watchAsset"),
          try: async () => {
            const result = await provider.request({
              method: "wallet_watchAsset",
              params: { options: params.options, type: params.type },
            });
            return result as boolean;
          },
        });
      }),
  });
}

export const WalletLifecycleFromProviderRefLive = Layer.effect(
  WalletLifecycle,
  Effect.gen(function* () {
    const providerRef = yield* WalletProviderRef;

    const getProvider = providerRef.get;

    return WalletLifecycle.of({
      isConnected: Effect.gen(function* () {
        const current = yield* getProvider;
        if (Option.isNone(current)) {
          return false;
        }

        const provider = current.value;
        const result = yield* Effect.promise(() =>
          provider
            .request({
              method: "eth_accounts",
            })
            .then((accountsResult) => accountsResult as Address[])
            .catch(() => [] as Address[])
        );

        return result.length > 0;
      }),
      addChain: (chain: AddChainParams) =>
        Effect.gen(function* () {
          const current = yield* getProvider;
          if (Option.isNone(current)) {
            return yield* Effect.fail(
              new AddChainError({
                chainId: chain.id,
                message: "No wallet provider set",
              })
            );
          }

          const provider = current.value;
          const chainIdHex = `0x${chain.id.toString(16)}`;
          const params = {
            blockExplorerUrls: chain.blockExplorerUrls,
            chainId: chainIdHex,
            chainName: chain.name,
            iconUrls: chain.iconUrls,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls?.http ?? [],
          };

          yield* Effect.tryPromise({
            catch: (error) => classifyWalletError(error, "addChain", { chainId: chain.id }),
            try: async () => {
              await provider.request({
                method: "wallet_addEthereumChain",
                params: [params],
              });
            },
          });
        }),

      connect: () =>
        Effect.gen(function* () {
          const current = yield* getProvider;
          if (Option.isNone(current)) {
            return yield* Effect.fail(
              new WalletConnectionError({
                message: "No wallet provider set",
              })
            );
          }

          const provider = current.value;
          const accounts = yield* Effect.tryPromise({
            catch: (error) => classifyWalletError(error, "connect"),
            try: async () => {
              const result = await provider.request({
                method: "eth_requestAccounts",
              });
              return result as Address[];
            },
          });

          if (accounts.length === 0) {
            return yield* Effect.fail(
              new WalletConnectionError({
                message: "No accounts returned from wallet",
              })
            );
          }

          return accounts;
        }).pipe(Effect.withSpan(SpanNames.WALLET_CONNECT)),

      disconnect: () =>
        Effect.sync(() => {
          // no-op (see makeWalletLifecycleLive)
        }),

      getChainId: () =>
        Effect.gen(function* () {
          const current = yield* getProvider;
          if (Option.isNone(current)) {
            return yield* Effect.fail(
              new AccountNotConnectedError({
                message: "No wallet provider set",
              })
            );
          }

          const provider = current.value;
          const chainIdHex = yield* Effect.tryPromise({
            catch: (error) =>
              new AccountNotConnectedError({
                message: error instanceof Error ? error.message : "Failed to get chain ID",
              }),
            try: async () => {
              const result = await provider.request({
                method: "eth_chainId",
              });
              return result as string;
            },
          });

          return Option.getOrElse(parseHexInt(chainIdHex), () => UNKNOWN_CHAIN_ID);
        }),

      switchChain: (chainId: number) =>
        Effect.gen(function* () {
          const current = yield* getProvider;
          if (Option.isNone(current)) {
            return yield* Effect.fail(
              new ChainSwitchErrorClass({
                chainId,
                message: "No wallet provider set",
              })
            );
          }

          const provider = current.value;
          yield* Effect.tryPromise({
            catch: (error) => classifyWalletError(error, "switchChain", { chainId }),
            try: async () => {
              await provider.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: `0x${chainId.toString(16)}` }],
              });
            },
          });
        }).pipe(
          Effect.withSpan("ew3.wallet.switchChain", {
            attributes: {
              chainId,
            },
          })
        ),

      watchAsset: (params: WatchAssetParams) =>
        Effect.gen(function* () {
          const current = yield* getProvider;
          if (Option.isNone(current)) {
            return yield* Effect.fail(
              new WatchAssetError({
                message: "No wallet provider set",
              })
            );
          }

          const provider = current.value;
          return yield* Effect.tryPromise({
            catch: (error) => classifyWalletError(error, "watchAsset"),
            try: async () => {
              const result = await provider.request({
                method: "wallet_watchAsset",
                params: { options: params.options, type: params.type },
              });
              return result as boolean;
            },
          });
        }),
    });
  })
);

/**
 * Default live layer that requires a WalletProvider to be provided separately
 */
export const WalletLifecycleLive = Layer.effect(
  WalletLifecycle,
  Effect.sync(() => {
    // This is a placeholder that will be replaced by makeWalletLifecycleLive
    // when a provider is available
    throw new Error(
      "WalletLifecycleLive requires a provider. Use makeWalletLifecycleLive instead."
    );
  })
);
