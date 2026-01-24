import type { Layer } from "effect";
import { Effect } from "effect";
import type { Address, Hash, TransactionReceipt } from "viem";
import { MIN_TX_GAS } from "@/src/constants/index.js";
import type {
  ClientNotFoundError,
  InsufficientFundsError,
  ReceiptTimeoutError,
  TxFailedError,
  UserRejectedError,
  WalletNotConnectedError,
  WrongNetworkError,
} from "@/src/core/index.js";
import type { TransferOverrides } from "@/src/transfer/index.js";
import { TransferService } from "@/src/transfer/index.js";
import { TEST_TX_HASH } from "./_fixtures/addresses.js";
import { TEST_RECEIPT } from "./_fixtures/receipts.js";
import { makeMockServiceLayer, withChainIdCheck } from "./helpers.js";

/**
 * Configuration for the mock TransferService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockTransferServiceConfig = {
  send?: (params: {
    chainId: number;
    to: Address;
    value: bigint;
    overrides?: TransferOverrides;
  }) => Effect.Effect<
    Hash,
    | InsufficientFundsError
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
    | ClientNotFoundError
    | TxFailedError
  >;

  sendAndWait?: (params: {
    chainId: number;
    to: Address;
    value: bigint;
    confirmations?: number;
    overrides?: TransferOverrides;
  }) => Effect.Effect<
    TransactionReceipt,
    | InsufficientFundsError
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
    | ClientNotFoundError
    | TxFailedError
    | ReceiptTimeoutError
  >;

  estimateGas?: (params: {
    chainId: number;
    to: Address;
    value: bigint;
  }) => Effect.Effect<bigint, ClientNotFoundError>;
};

const defaultConfig: Required<MockTransferServiceConfig> = {
  estimateGas: () => Effect.succeed(MIN_TX_GAS),
  send: () => Effect.succeed(TEST_TX_HASH),
  sendAndWait: () => Effect.succeed(TEST_RECEIPT as TransactionReceipt),
};

/**
 * Creates a mock TransferService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainId - The chainId this mock supports (default: 1 mainnet)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockTransferServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockTransferServiceLayer({
 *   send: () => Effect.succeed("0x123..."),
 *   estimateGas: () => Effect.succeed(21000n),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const transferService = yield* TransferService;
 *   const hash = yield* transferService.send({
 *     chainId: mainnet.id,
 *     to: "0x...",
 *     value: 1000000000000000000n, // 1 ETH
 *   });
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockTransferServiceLayer = (
  config: MockTransferServiceConfig = {},
  supportedChainId = 1
): Layer.Layer<TransferService> =>
  makeMockServiceLayer(TransferService, defaultConfig, config, (merged) => ({
    estimateGas: withChainIdCheck(supportedChainId, merged.estimateGas),
    send: withChainIdCheck(supportedChainId, merged.send),
    sendAndWait: withChainIdCheck(supportedChainId, merged.sendAndWait),
  }));
