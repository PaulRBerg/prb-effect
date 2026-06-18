import type { Transaction } from "@solana/web3.js";
import { Context, Effect, Layer } from "effect";
import { SignatureError, WalletNotConnectedError } from "#src/core/errors/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import type { Address } from "#src/types/index.js";

export type SignerServiceShape = {
  /**
   * Get the connected wallet's address.
   */
  readonly getAddress: () => Effect.Effect<Address, WalletNotConnectedError>;

  /**
   * Sign a single transaction.
   */
  readonly signTransaction: <T extends Transaction>(
    tx: T
  ) => Effect.Effect<T, SignatureError | WalletNotConnectedError>;

  /**
   * Sign multiple transactions in a batch.
   */
  readonly signAllTransactions: <T extends Transaction>(
    txs: readonly T[]
  ) => Effect.Effect<readonly T[], SignatureError | WalletNotConnectedError>;

  /**
   * Check if a wallet is connected.
   */
  readonly isConnected: () => Effect.Effect<boolean>;
};

export class SignerService extends Context.Tag("esolana/SignerService")<
  SignerService,
  SignerServiceShape
>() {}

/**
 * Wallet adapter interface - consumers implement this to integrate their wallet.
 */
export type WalletAdapter = {
  readonly publicKey: Address | null;
  readonly connected: boolean;
  readonly signTransaction: <T extends Transaction>(tx: T) => Promise<T>;
  readonly signAllTransactions: <T extends Transaction>(txs: readonly T[]) => Promise<readonly T[]>;
};

/**
 * Create a SignerService layer from a wallet adapter.
 * This is used to bridge wallet-adapter-react or similar libraries.
 */
export const makeSignerServiceFromAdapter = (getAdapter: () => WalletAdapter) =>
  Layer.succeed(
    SignerService,
    SignerService.of({
      getAddress: () =>
        Effect.gen(function* () {
          const adapter = getAdapter();
          if (!(adapter.connected && adapter.publicKey)) {
            return yield* Effect.fail(
              new WalletNotConnectedError({ message: "Wallet not connected" })
            );
          }
          return adapter.publicKey;
        }).pipe(Effect.withSpan(SpanNames.SIGNER_GET_ADDRESS)),

      isConnected: () => Effect.sync(() => getAdapter().connected),

      signAllTransactions: (txs) =>
        Effect.gen(function* () {
          const adapter = getAdapter();
          if (!adapter.connected) {
            return yield* Effect.fail(
              new WalletNotConnectedError({ message: "Wallet not connected" })
            );
          }
          return yield* Effect.tryPromise({
            catch: (cause) =>
              new SignatureError({
                cause,
                message: cause instanceof Error ? cause.message : "Failed to sign transactions",
              }),
            try: () => adapter.signAllTransactions(txs),
          });
        }).pipe(Effect.withSpan(SpanNames.TX_SIGN)),

      signTransaction: (tx) =>
        Effect.gen(function* () {
          const adapter = getAdapter();
          if (!adapter.connected) {
            return yield* Effect.fail(
              new WalletNotConnectedError({ message: "Wallet not connected" })
            );
          }
          return yield* Effect.tryPromise({
            catch: (cause) =>
              new SignatureError({
                cause,
                message: cause instanceof Error ? cause.message : "Failed to sign transaction",
              }),
            try: () => adapter.signTransaction(tx),
          });
        }).pipe(Effect.withSpan(SpanNames.TX_SIGN)),
    })
  );
