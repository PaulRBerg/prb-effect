import { Context, Effect, Layer, Option, Stream } from "effect";
import type { Address, Hex, TypedData } from "viem";
import { parseHexInt } from "@/src/internal/index.js";
import type {
  SignMessageError,
  SignMessageParams,
  SignTransactionParams,
  SignTxError,
  SignTypedDataError,
  SignTypedDataParams,
  WalletProvider,
} from "@/src/wallet/index.js";
import {
  AccountNotConnectedError,
  signMessage,
  signTransaction,
  signTypedData,
  WalletProviderRef,
} from "@/src/wallet/index.js";

export const UNKNOWN_CHAIN_ID = 0;

const accountsStreamFromProvider = (provider: WalletProvider) =>
  Stream.async<Address[], never>((emit) => {
    provider
      .request({ method: "eth_accounts" })
      .then((result) => {
        const accounts = (result as Address[]) || [];
        emit.single(accounts);
      })
      .catch(() => {
        emit.single([]);
      });

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as Address[];
      emit.single(accounts);
    };

    if ("on" in provider && typeof provider.on === "function") {
      (
        provider as {
          on: (event: string, handler: (...args: unknown[]) => void) => void;
        }
      ).on("accountsChanged", handleAccountsChanged);
    }

    return Effect.sync(() => {
      if ("removeListener" in provider && typeof provider.removeListener === "function") {
        (
          provider as {
            removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
          }
        ).removeListener("accountsChanged", handleAccountsChanged);
      }
    });
  });

const chainIdStreamFromProvider = (provider: WalletProvider) =>
  Stream.async<number, never>((emit) => {
    provider
      .request({ method: "eth_chainId" })
      .then((result) => {
        const chainIdHex = result as string;
        const parsed = Option.getOrElse(parseHexInt(chainIdHex), () => UNKNOWN_CHAIN_ID);
        emit.single(parsed);
      })
      .catch(() => {
        emit.single(UNKNOWN_CHAIN_ID);
      });

    const handleChainChanged = (...args: unknown[]) => {
      const chainIdHex = args[0] as string;
      const parsed = Option.getOrElse(parseHexInt(chainIdHex), () => UNKNOWN_CHAIN_ID);
      emit.single(parsed);
    };

    if ("on" in provider && typeof provider.on === "function") {
      (
        provider as {
          on: (event: string, handler: (...args: unknown[]) => void) => void;
        }
      ).on("chainChanged", handleChainChanged);
    }

    return Effect.sync(() => {
      if ("removeListener" in provider && typeof provider.removeListener === "function") {
        (
          provider as {
            removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
          }
        ).removeListener("chainChanged", handleChainChanged);
      }
    });
  });

/**
 * Service for wallet account management and signing operations
 */
export type WalletServiceShape = {
  readonly accounts: Effect.Effect<Stream.Stream<Address[], never>, never>;
  readonly currentAccount: Effect.Effect<Address, AccountNotConnectedError>;
  readonly chainId: Effect.Effect<Stream.Stream<number, never>, never>;
  readonly currentChainId: Effect.Effect<number, AccountNotConnectedError>;
  readonly signMessage: (
    params: SignMessageParams
  ) => Effect.Effect<Hex, SignMessageError | AccountNotConnectedError>;
  readonly signTypedData: <
    const typedData extends TypedData | Record<string, unknown>,
    primaryType extends keyof typedData | "EIP712Domain",
  >(
    params: SignTypedDataParams<typedData, primaryType>
  ) => Effect.Effect<Hex, SignTypedDataError | AccountNotConnectedError>;
  readonly signTransaction: (
    params: SignTransactionParams
  ) => Effect.Effect<Hex, SignTxError | AccountNotConnectedError>;
};

export class WalletService extends Context.Tag("ew3/WalletService")<
  WalletService,
  WalletServiceShape
>() {}

/**
 * Create a live implementation of WalletService
 */
export function makeWalletServiceLive(provider: WalletProvider): Layer.Layer<WalletService> {
  return Layer.succeed(WalletService, {
    accounts: Effect.succeed(accountsStreamFromProvider(provider)),

    chainId: Effect.succeed(chainIdStreamFromProvider(provider)),

    currentAccount: Effect.gen(function* () {
      const accounts = yield* Effect.tryPromise({
        catch: (error) =>
          new AccountNotConnectedError({
            message: error instanceof Error ? error.message : "Failed to get accounts",
          }),
        try: async () => {
          const result = await provider.request({
            method: "eth_accounts",
          });
          return result as Address[];
        },
      });

      if (accounts.length === 0) {
        return yield* Effect.fail(
          new AccountNotConnectedError({
            message: "No wallet account connected",
          })
        );
      }

      return accounts[0];
    }),

    currentChainId: Effect.gen(function* () {
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

    signMessage: (params: SignMessageParams) => signMessage(provider, params),

    signTransaction: (params: SignTransactionParams) => signTransaction(provider, params),

    signTypedData: <
      const typedData extends TypedData | Record<string, unknown>,
      primaryType extends keyof typedData | "EIP712Domain",
    >(
      params: SignTypedDataParams<typedData, primaryType>
    ) => signTypedData(provider, params),
  });
}

export const WalletServiceFromProviderRefLive = Layer.effect(
  WalletService,
  Effect.gen(function* () {
    const providerRef = yield* WalletProviderRef;

    const getProviderOrFail = Effect.gen(function* () {
      const current = yield* providerRef.get;
      if (Option.isNone(current)) {
        return yield* Effect.fail(
          new AccountNotConnectedError({
            message: "No wallet provider set",
          })
        );
      }
      return current.value;
    });

    const accountsStream = providerRef.ref.changes.pipe(
      Stream.flatMap(
        (current) =>
          Option.isNone(current)
            ? Stream.succeed([] as Address[])
            : accountsStreamFromProvider(current.value),
        { switch: true }
      )
    );

    const chainIdStream = providerRef.ref.changes.pipe(
      Stream.flatMap(
        (current) =>
          Option.isNone(current)
            ? Stream.succeed(UNKNOWN_CHAIN_ID)
            : chainIdStreamFromProvider(current.value),
        { switch: true }
      )
    );

    return WalletService.of({
      accounts: Effect.succeed(accountsStream),
      chainId: Effect.succeed(chainIdStream),

      currentAccount: Effect.gen(function* () {
        const provider = yield* getProviderOrFail;
        const accounts = yield* Effect.tryPromise({
          catch: (error) =>
            new AccountNotConnectedError({
              message: error instanceof Error ? error.message : "Failed to get accounts",
            }),
          try: async () => {
            const result = await provider.request({ method: "eth_accounts" });
            return result as Address[];
          },
        });

        if (accounts.length === 0) {
          return yield* Effect.fail(
            new AccountNotConnectedError({
              message: "No wallet account connected",
            })
          );
        }

        return accounts[0];
      }),

      currentChainId: Effect.gen(function* () {
        const provider = yield* getProviderOrFail;
        const chainIdHex = yield* Effect.tryPromise({
          catch: (error) =>
            new AccountNotConnectedError({
              message: error instanceof Error ? error.message : "Failed to get chain ID",
            }),
          try: async () => {
            const result = await provider.request({ method: "eth_chainId" });
            return result as string;
          },
        });

        return Option.getOrElse(parseHexInt(chainIdHex), () => UNKNOWN_CHAIN_ID);
      }),

      signMessage: (params) =>
        getProviderOrFail.pipe(Effect.flatMap((provider) => signMessage(provider, params))),

      signTransaction: (params) =>
        getProviderOrFail.pipe(Effect.flatMap((provider) => signTransaction(provider, params))),

      signTypedData: <
        const typedData extends TypedData | Record<string, unknown>,
        primaryType extends keyof typedData | "EIP712Domain",
      >(
        params: SignTypedDataParams<typedData, primaryType>
      ) => getProviderOrFail.pipe(Effect.flatMap((provider) => signTypedData(provider, params))),
    });
  })
);

/**
 * Default live layer that requires a WalletProvider to be provided separately
 */
export const WalletServiceLive = Layer.effect(
  WalletService,
  Effect.sync(() => {
    // This is a placeholder that will be replaced by makeWalletServiceLive
    // when a provider is available
    throw new Error("WalletServiceLive requires a provider. Use makeWalletServiceLive instead.");
  })
);
