import { Effect, Layer } from "effect";
import { SignatureError, WalletNotConnectedError } from "#src/core/errors/index.js";
import { SignerService } from "#src/signer/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import { fromWeb3Transaction, toWeb3Transaction } from "./transaction-bridge.js";
import type { LegacyWalletAdapter } from "./types.js";
import { publicKeyToAddress } from "./types.js";

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
export function makeSignerServiceFromLegacyAdapter(
  getAdapter: () => LegacyWalletAdapter
): Layer.Layer<SignerService> {
  return Layer.succeed(
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

          // Runtime validation before type assertion
          if (
            typeof adapter.publicKey !== "object" ||
            adapter.publicKey === null ||
            typeof (adapter.publicKey as { toBase58?: unknown }).toBase58 !== "function"
          ) {
            return yield* Effect.fail(
              new WalletNotConnectedError({
                message: "Invalid publicKey: missing toBase58 method",
              })
            );
          }

          return publicKeyToAddress(adapter.publicKey as { toBase58(): string });
        }).pipe(Effect.withSpan(SpanNames.SIGNER_GET_ADDRESS)),

      isConnected: () => Effect.sync(() => getAdapter().connected),

      signAllTransactions: (txs) =>
        Effect.gen(function* () {
          // Early return for empty arrays
          if (txs.length === 0) {
            return [] as typeof txs;
          }

          const adapter = getAdapter();
          if (!adapter.connected) {
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

          // Sign all with legacy adapter
          const signedAll = yield* Effect.tryPromise({
            catch: (cause) =>
              new SignatureError({
                cause,
                message: cause instanceof Error ? cause.message : "Failed to sign transactions",
              }),
            try: () => adapter.signAllTransactions(legacyTxs),
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
          if (!adapter.connected) {
            return yield* Effect.fail(
              new WalletNotConnectedError({ message: "Wallet not connected" })
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
