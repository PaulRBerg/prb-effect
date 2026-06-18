import { Effect, Layer } from "effect";
import { SignatureError, WalletNotConnectedError } from "#src/core/errors/index.js";
import { SignerService } from "#src/signer/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import { fromWeb3Transaction, toWeb3Transaction } from "./tx-bridge.js";
import type { LegacyWalletAdapter, Web3SignAdapter } from "./types.js";
import {
  getWeb3WalletAddress,
  hasSignAllTransactions,
  hasSignTransaction,
  isWeb3WalletConnected,
} from "./types.js";

/**
 * Create a SignerService layer from a legacy wallet adapter.
 *
 * This factory bridges the gap between legacy @solana/web3.js wallet adapters
 * (like @reown/appkit-adapter-solana) and the modern @solana/kit types used
 * by @prb/effect-solana.
 *
 * @param getAdapter - Function that returns the current wallet adapter
 * @returns A Layer providing SignerService
 *
 * @category Compatibility
 *
 * @example
 * ```typescript
 * import { makeSignerServiceFromLegacyAdapter } from "@prb/effect-solana/compat";
 *
 * const signerLayer = makeSignerServiceFromLegacyAdapter(() => ({
 *   publicKey: walletProvider?.publicKey ?? null,
 *   connected: !!walletProvider?.publicKey,
 *   signTransaction: walletProvider.signTransaction.bind(walletProvider),
 *   signAllTransactions: walletProvider.signAllTransactions.bind(walletProvider),
 * }));
 * ```
 */
export function makeSignerServiceFromWeb3Adapter(
  getAdapter: () => Web3SignAdapter
): Layer.Layer<SignerService> {
  return Layer.succeed(
    SignerService,
    SignerService.of({
      getAddress: () =>
        Effect.gen(function* () {
          const adapter = getAdapter();
          if (!isWeb3WalletConnected(adapter)) {
            return yield* Effect.fail(
              new WalletNotConnectedError({ message: "Wallet not connected" })
            );
          }

          const address = yield* Effect.try({
            catch: (cause) =>
              new WalletNotConnectedError({
                message: cause instanceof Error ? cause.message : "Invalid wallet address",
              }),
            try: () => getWeb3WalletAddress(adapter),
          });

          if (!address) {
            return yield* Effect.fail(
              new WalletNotConnectedError({ message: "Wallet address not available" })
            );
          }

          return address;
        }).pipe(Effect.withSpan(SpanNames.SIGNER_GET_ADDRESS)),

      isConnected: () => Effect.sync(() => isWeb3WalletConnected(getAdapter())),

      signAllTransactions: (txs) =>
        Effect.gen(function* () {
          // Early return for empty arrays
          if (txs.length === 0) {
            return [] as typeof txs;
          }

          const adapter = getAdapter();
          if (!isWeb3WalletConnected(adapter)) {
            return yield* Effect.fail(
              new WalletNotConnectedError({ message: "Wallet not connected" })
            );
          }

          // Convert all kit → web3.js
          const legacyTxs = yield* Effect.all(
            txs.map((tx) =>
              Effect.tryPromise({
                catch: (cause) =>
                  new SignatureError({
                    cause,
                    message:
                      cause instanceof Error ? cause.message : "Failed to convert transaction",
                  }),
                try: () => toWeb3Transaction(tx),
              })
            )
          );

          if (!(hasSignAllTransactions(adapter) || hasSignTransaction(adapter))) {
            return yield* Effect.fail(
              new SignatureError({
                message: "Wallet does not support signAllTransactions or signTransaction",
              })
            );
          }

          const signedAll = yield* Effect.tryPromise({
            catch: (cause) =>
              new SignatureError({
                cause,
                message: cause instanceof Error ? cause.message : "Failed to sign transactions",
              }),
            try: () =>
              hasSignAllTransactions(adapter)
                ? adapter.signAllTransactions(legacyTxs)
                : Promise.all(legacyTxs.map((tx) => adapter.signTransaction(tx))),
          });

          // Convert all web3.js → kit
          // Cast is necessary because we can't preserve the generic T through web3.js conversion
          return signedAll.map((signed) =>
            fromWeb3Transaction(signed as Parameters<typeof fromWeb3Transaction>[0])
          ) as typeof txs;
        }).pipe(Effect.withSpan(SpanNames.TX_SIGN)),

      signTransaction: (tx) =>
        Effect.gen(function* () {
          const adapter = getAdapter();
          if (!isWeb3WalletConnected(adapter)) {
            return yield* Effect.fail(
              new WalletNotConnectedError({ message: "Wallet not connected" })
            );
          }

          if (!hasSignTransaction(adapter)) {
            return yield* Effect.fail(
              new SignatureError({ message: "Wallet does not support signTransaction" })
            );
          }

          // Convert kit → web3.js
          const legacyTx = yield* Effect.tryPromise({
            catch: (cause) =>
              new SignatureError({
                cause,
                message: cause instanceof Error ? cause.message : "Failed to convert transaction",
              }),
            try: () => toWeb3Transaction(tx),
          });

          // Sign with legacy adapter
          const signed = yield* Effect.tryPromise({
            catch: (cause) =>
              new SignatureError({
                cause,
                message: cause instanceof Error ? cause.message : "Failed to sign transaction",
              }),
            try: () => adapter.signTransaction(legacyTx),
          });

          // Convert web3.js → kit
          // Cast is necessary because we can't preserve the generic T through web3.js conversion
          return fromWeb3Transaction(
            signed as Parameters<typeof fromWeb3Transaction>[0]
          ) as typeof tx;
        }).pipe(Effect.withSpan(SpanNames.TX_SIGN)),
    })
  );
}

export function makeSignerServiceFromLegacyAdapter(
  getAdapter: () => LegacyWalletAdapter
): Layer.Layer<SignerService> {
  return makeSignerServiceFromWeb3Adapter(getAdapter);
}
