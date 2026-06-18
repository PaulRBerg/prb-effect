import type { TransactionInstruction, TransactionSignature } from "@solana/web3.js";
import { Transaction } from "@solana/web3.js";
import type { Layer } from "effect";
import { Effect } from "effect";
import type {
  BlockhashExpiredError,
  SimulationFailedError,
  TransactionFailedError,
  TransactionSendError,
  TransactionTimeoutError,
  WalletNotConnectedError,
} from "#src/core/errors/index.js";
import type {
  ConfirmOpts,
  SignableTransactionMessage,
  TransactionBatchItem,
  TransactionBatchOpts,
  TransactionReceipt,
} from "#src/tx/index.js";
import { TransactionService } from "#src/tx/index.js";
import { TEST_SIGNATURE } from "./_fixtures/addresses.js";
import { makeMockServiceLayer } from "./helpers.js";

/**
 * Configuration for the mock TransactionService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockTransactionServiceConfig = {
  readonly build?: (
    instructions: readonly TransactionInstruction[]
  ) => Effect.Effect<SignableTransactionMessage, TransactionSendError | WalletNotConnectedError>;
  readonly signAll?: (
    txs: readonly SignableTransactionMessage[]
  ) => Effect.Effect<readonly Transaction[], TransactionSendError | WalletNotConnectedError>;
  readonly sign?: <T extends SignableTransactionMessage>(
    tx: T
  ) => Effect.Effect<T, TransactionSendError | WalletNotConnectedError>;
  readonly sendAll?: (
    txs: readonly Transaction[],
    opts?: TransactionBatchOpts
  ) => Effect.Effect<readonly TransactionSignature[], TransactionSendError>;
  readonly send?: (tx: Transaction) => Effect.Effect<TransactionSignature, TransactionSendError>;
  readonly confirm?: (
    signature: TransactionSignature,
    opts?: ConfirmOpts
  ) => Effect.Effect<
    TransactionReceipt,
    TransactionTimeoutError | TransactionFailedError | BlockhashExpiredError
  >;
  readonly sendAndConfirm?: (
    instructions: readonly TransactionInstruction[],
    opts?: ConfirmOpts
  ) => Effect.Effect<
    TransactionReceipt,
    | TransactionSendError
    | WalletNotConnectedError
    | TransactionTimeoutError
    | TransactionFailedError
    | BlockhashExpiredError
  >;
  readonly sendAndConfirmBatch?: (
    items: readonly TransactionBatchItem[],
    opts?: TransactionBatchOpts
  ) => Effect.Effect<
    readonly TransactionReceipt[],
    | TransactionSendError
    | WalletNotConnectedError
    | TransactionTimeoutError
    | TransactionFailedError
    | BlockhashExpiredError
  >;
  readonly simulate?: <T extends SignableTransactionMessage>(
    tx: T
  ) => Effect.Effect<void, SimulationFailedError | TransactionSendError | WalletNotConnectedError>;
};

const makeReceipt = (signature: TransactionSignature): TransactionReceipt => ({
  confirmations: 10n,
  signature,
  slot: 1000n,
});

const defaultConfig: Required<MockTransactionServiceConfig> = {
  build: () => Effect.succeed(new Transaction()),
  confirm: (signature) => Effect.succeed(makeReceipt(signature)),
  send: () => Effect.succeed(TEST_SIGNATURE),
  sendAll: (txs) => Effect.succeed(txs.map(() => TEST_SIGNATURE)),
  sendAndConfirm: () => Effect.succeed(makeReceipt(TEST_SIGNATURE)),
  sendAndConfirmBatch: (items) => Effect.succeed(items.map(() => makeReceipt(TEST_SIGNATURE))),
  sign: (tx) => Effect.succeed(tx),
  signAll: (txs) => Effect.succeed(txs),
  simulate: () => Effect.void,
};

/**
 * Creates a mock TransactionService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 */
export const makeMockTransactionServiceLayer = (
  config: MockTransactionServiceConfig = {}
): Layer.Layer<TransactionService> =>
  makeMockServiceLayer(TransactionService, defaultConfig, config, (merged) => merged);
