import type { Instruction } from "@solana/instructions";
import type { Signature } from "@solana/keys";
import type { Transaction, TransactionWithLifetime } from "@solana/transactions";
import type { Layer } from "effect";
import { Effect } from "effect";
import type {
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
  build?: (
    instructions: readonly Instruction[]
  ) => Effect.Effect<SignableTransactionMessage, TransactionSendError | WalletNotConnectedError>;
  signAll?: (
    txs: readonly SignableTransactionMessage[]
  ) => Effect.Effect<
    readonly (Transaction & TransactionWithLifetime)[],
    TransactionSendError | WalletNotConnectedError
  >;
  sign?: <T extends SignableTransactionMessage>(
    tx: T
  ) => Effect.Effect<
    Transaction & TransactionWithLifetime,
    TransactionSendError | WalletNotConnectedError
  >;
  sendAll?: (
    txs: readonly (Transaction & TransactionWithLifetime)[],
    opts?: TransactionBatchOpts
  ) => Effect.Effect<readonly Signature[], TransactionSendError>;
  send?: (
    tx: Transaction & TransactionWithLifetime
  ) => Effect.Effect<Signature, TransactionSendError>;
  confirm?: (
    signature: Signature,
    opts?: ConfirmOpts
  ) => Effect.Effect<TransactionReceipt, TransactionTimeoutError | TransactionFailedError>;
  sendAndConfirm?: (
    instructions: readonly Instruction[],
    opts?: ConfirmOpts
  ) => Effect.Effect<
    TransactionReceipt,
    | TransactionSendError
    | WalletNotConnectedError
    | TransactionTimeoutError
    | TransactionFailedError
  >;
  sendAndConfirmBatch?: (
    items: readonly TransactionBatchItem[],
    opts?: TransactionBatchOpts
  ) => Effect.Effect<
    readonly TransactionReceipt[],
    | TransactionSendError
    | WalletNotConnectedError
    | TransactionTimeoutError
    | TransactionFailedError
  >;
  simulate?: <T extends SignableTransactionMessage>(
    tx: T
  ) => Effect.Effect<void, SimulationFailedError | TransactionSendError | WalletNotConnectedError>;
};

const defaultConfig: Required<MockTransactionServiceConfig> = {
  build: () => Effect.succeed({} as SignableTransactionMessage),
  confirm: (signature) =>
    Effect.succeed({
      confirmations: 10n,
      signature,
      slot: 1000n,
    }),
  send: () => Effect.succeed(TEST_SIGNATURE as Signature),
  sendAll: (txs) => Effect.succeed(txs.map(() => TEST_SIGNATURE as Signature)),
  sendAndConfirm: () =>
    Effect.succeed({
      confirmations: 10n,
      signature: TEST_SIGNATURE as Signature,
      slot: 1000n,
    }),
  sendAndConfirmBatch: (items) =>
    Effect.succeed(
      items.map(() => ({
        confirmations: 10n,
        signature: TEST_SIGNATURE as Signature,
        slot: 1000n,
      }))
    ),
  sign: () => Effect.succeed({} as Transaction & TransactionWithLifetime),
  signAll: (txs) => Effect.succeed(txs.map(() => ({}) as Transaction & TransactionWithLifetime)),
  simulate: () => Effect.void,
};

/**
 * Creates a mock TransactionService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockTransactionServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockTransactionServiceLayer({
 *   sendAndConfirm: () => Effect.fail(
 *     new TransactionFailedError({
 *       signature: TEST_SIGNATURE,
 *       message: "Transaction failed",
 *       logs: [],
 *     })
 *   ),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const txService = yield* TransactionService;
 *   const receipt = yield* txService.sendAndConfirm(instructions);
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockTransactionServiceLayer = (
  config: MockTransactionServiceConfig = {}
): Layer.Layer<TransactionService> =>
  makeMockServiceLayer(TransactionService, defaultConfig, config, (merged) => merged);
