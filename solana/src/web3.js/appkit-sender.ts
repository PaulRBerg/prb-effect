import { signature } from "@solana/keys";
import type { Transaction, TransactionWithLifetime } from "@solana/transactions";
import { Effect, Layer } from "effect";
import {
  isLikelyUserRejectedError,
  TransactionSendError,
  UserRejectedError,
  WalletCapabilityError,
  WalletNotConnectedError,
} from "#src/core/errors/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import type { WalletSendOpts } from "#src/tx/index.js";
import { WalletSendService } from "#src/tx/index.js";
import { toWeb3Transaction } from "./tx-bridge.js";
import type { AppKitSolanaProvider, Web3ConnectionLike } from "./types.js";
import { hasSendTransaction, isWeb3WalletConnected } from "./types.js";

const getConnection = (
  provider: AppKitSolanaProvider,
  getConnectionOverride?: () => Web3ConnectionLike | null | undefined
): Web3ConnectionLike | null => {
  const connection = getConnectionOverride?.() ?? provider.connection;
  return connection ?? null;
};

const normalizeSendError = (cause: unknown) => {
  if (isLikelyUserRejectedError(cause)) {
    return new UserRejectedError({ message: "User rejected transaction" });
  }

  return new TransactionSendError({
    cause,
    message: cause instanceof Error ? cause.message : "Failed to send transaction with wallet",
  });
};

/**
 * Create a WalletSendService layer from an AppKit Solana provider.
 *
 * @category Compatibility
 */
export function makeWalletSendServiceFromAppKitProvider(
  getProvider: () => AppKitSolanaProvider | null | undefined,
  getConnectionOverride?: () => Web3ConnectionLike | null | undefined
): Layer.Layer<WalletSendService> {
  return Layer.succeed(
    WalletSendService,
    WalletSendService.of({
      sendTransaction: (tx: Transaction & TransactionWithLifetime, opts?: WalletSendOpts) =>
        Effect.gen(function* () {
          const provider = getProvider();
          if (!provider || !isWeb3WalletConnected(provider)) {
            return yield* Effect.fail(
              new WalletNotConnectedError({ message: "Wallet not connected" })
            );
          }

          if (!hasSendTransaction(provider)) {
            return yield* Effect.fail(
              new WalletCapabilityError({
                capability: "sendTransaction",
                message: "Wallet does not support sendTransaction",
              })
            );
          }

          const connection = getConnection(provider, getConnectionOverride);
          if (!connection) {
            return yield* Effect.fail(
              new WalletCapabilityError({
                capability: "connection",
                message: "A web3.js Connection is required for wallet sendTransaction",
              })
            );
          }

          const web3Transaction = yield* Effect.tryPromise({
            catch: (cause) =>
              new TransactionSendError({
                cause,
                message: cause instanceof Error ? cause.message : "Failed to convert transaction",
              }),
            try: () => toWeb3Transaction(tx),
          });

          const rawSignature = yield* Effect.tryPromise({
            catch: normalizeSendError,
            try: () => provider.sendTransaction(web3Transaction, connection, opts),
          });

          return yield* Effect.try({
            catch: (cause) =>
              new TransactionSendError({
                cause,
                message: "Wallet returned an invalid transaction signature",
              }),
            try: () => signature(rawSignature),
          });
        }).pipe(Effect.withSpan(SpanNames.TX_SEND)),
    })
  );
}
