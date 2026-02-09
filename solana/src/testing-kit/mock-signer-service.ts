import type { Address } from "@solana/addresses";
import type { Transaction, TransactionWithLifetime } from "@solana/transactions";
import { Effect, Layer } from "effect";
import type { SignatureError } from "#src/core/errors/index.js";
import { WalletNotConnectedError } from "#src/core/errors/index.js";
import { SignerService } from "#src/signer/index.js";
import { TEST_WALLET } from "./_fixtures/addresses.js";

/**
 * Configuration for the mock SignerService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockSignerServiceConfig = {
  address?: Address;
  connected?: boolean;
  getAddress?: () => Effect.Effect<Address, WalletNotConnectedError>;
  signTransaction?: <T extends Transaction & TransactionWithLifetime>(
    tx: T
  ) => Effect.Effect<T, SignatureError | WalletNotConnectedError>;
  signAllTransactions?: <T extends Transaction & TransactionWithLifetime>(
    txs: readonly T[]
  ) => Effect.Effect<readonly T[], SignatureError | WalletNotConnectedError>;
  isConnected?: () => Effect.Effect<boolean>;
};

/**
 * Creates a mock SignerService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 *
 * @example
 * ```typescript
 * // Basic usage with defaults (connected wallet)
 * const layer = makeMockSignerServiceLayer();
 *
 * // Simulate disconnected wallet
 * const disconnectedLayer = makeMockSignerServiceLayer({
 *   connected: false,
 * });
 *
 * // Custom address
 * const customLayer = makeMockSignerServiceLayer({
 *   address: "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK" as Address,
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const signer = yield* SignerService;
 *   const address = yield* signer.getAddress();
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockSignerServiceLayer = (
  config: MockSignerServiceConfig = {}
): Layer.Layer<SignerService> => {
  const address = config.address ?? TEST_WALLET;
  const connected = config.connected ?? true;

  const defaultGetAddress = () =>
    connected
      ? Effect.succeed(address)
      : Effect.fail(new WalletNotConnectedError({ message: "Wallet not connected" }));

  const defaultSignTransaction = <T extends Transaction & TransactionWithLifetime>(tx: T) =>
    connected
      ? Effect.succeed(tx)
      : Effect.fail(new WalletNotConnectedError({ message: "Wallet not connected" }));

  const defaultSignAllTransactions = <T extends Transaction & TransactionWithLifetime>(
    txs: readonly T[]
  ) =>
    connected
      ? Effect.succeed(txs)
      : Effect.fail(new WalletNotConnectedError({ message: "Wallet not connected" }));

  const defaultIsConnected = () => Effect.succeed(connected);

  return Layer.succeed(
    SignerService,
    SignerService.of({
      getAddress: config.getAddress ?? defaultGetAddress,
      isConnected: config.isConnected ?? defaultIsConnected,
      signAllTransactions: config.signAllTransactions ?? defaultSignAllTransactions,
      signTransaction: config.signTransaction ?? defaultSignTransaction,
    })
  );
};
