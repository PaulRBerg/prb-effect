import { pipe } from "@solana/functional";
import type { Instruction } from "@solana/instructions";
import type { Signature } from "@solana/keys";
import type { CompilableTransactionMessage } from "@solana/transaction-messages";
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/transaction-messages";
import type { Transaction, TransactionWithLifetime } from "@solana/transactions";
import {
  compileTransaction,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
} from "@solana/transactions";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { Context, Duration, Effect, Layer, Schedule } from "effect";
import type { WalletNotConnectedError } from "@/src/core/errors/index.js";
import {
  SignatureError,
  SimulationFailedError,
  TransactionFailedError,
  TransactionSendError,
  TransactionTimeoutError,
} from "@/src/core/errors/index.js";
import type { RpcServiceShape } from "@/src/rpc/index.js";
import { RpcService } from "@/src/rpc/index.js";
import { SignerService } from "@/src/signer/index.js";
import { SpanNames } from "@/src/telemetry/index.js";
import type {
  ComputeBudgetConfig,
  ConfirmOpts,
  TransactionBatchItem,
  TransactionBatchOpts,
  TransactionBuildOpts,
  TransactionReceipt,
} from "./types.js";

/**
 * Shape of the TransactionService for type inference.
 *
 * @category Services
 */
export type TransactionServiceShape = {
  /**
   * Build a transaction from instructions.
   */
  readonly build: (
    instructions: readonly Instruction[],
    opts?: TransactionBuildOpts
  ) => Effect.Effect<CompilableTransactionMessage, TransactionSendError | WalletNotConnectedError>;

  /**
   * Sign multiple transactions in a batch.
   */
  readonly signAll: (
    txs: readonly CompilableTransactionMessage[]
  ) => Effect.Effect<
    readonly (Transaction & TransactionWithLifetime)[],
    TransactionSendError | WalletNotConnectedError
  >;

  /**
   * Sign a transaction.
   */
  readonly sign: <T extends CompilableTransactionMessage>(
    tx: T
  ) => Effect.Effect<
    Transaction & TransactionWithLifetime,
    TransactionSendError | WalletNotConnectedError
  >;

  /**
   * Send multiple signed transactions.
   */
  readonly sendAll: (
    txs: readonly (Transaction & TransactionWithLifetime)[],
    opts?: TransactionBatchOpts
  ) => Effect.Effect<readonly Signature[], TransactionSendError>;

  /**
   * Send a signed transaction.
   */
  readonly send: (
    tx: Transaction & TransactionWithLifetime
  ) => Effect.Effect<Signature, TransactionSendError>;

  /**
   * Confirm a transaction by signature.
   */
  readonly confirm: (
    signature: Signature,
    opts?: ConfirmOpts
  ) => Effect.Effect<TransactionReceipt, TransactionTimeoutError | TransactionFailedError>;

  /**
   * Build, sign, send, and confirm a transaction.
   */
  readonly sendAndConfirm: (
    instructions: readonly Instruction[],
    opts?: ConfirmOpts & { computeBudget?: ComputeBudgetConfig }
  ) => Effect.Effect<
    TransactionReceipt,
    | TransactionSendError
    | WalletNotConnectedError
    | TransactionTimeoutError
    | TransactionFailedError
  >;

  /**
   * Build, sign, send, and confirm a batch of transactions.
   */
  readonly sendAndConfirmBatch: (
    items: readonly TransactionBatchItem[],
    opts?: TransactionBatchOpts
  ) => Effect.Effect<
    readonly TransactionReceipt[],
    | TransactionSendError
    | WalletNotConnectedError
    | TransactionTimeoutError
    | TransactionFailedError
  >;

  /**
   * Simulate a transaction.
   */
  readonly simulate: <T extends CompilableTransactionMessage>(
    tx: T
  ) => Effect.Effect<void, SimulationFailedError | TransactionSendError | WalletNotConnectedError>;
};

/**
 * Service tag for transaction operations.
 *
 * @category Services
 */
export class TransactionService extends Context.Tag("esolana/TransactionService")<
  TransactionService,
  TransactionServiceShape
>() {}

/**
 * Check if a transaction has reached the desired confirmation level.
 */
const hasReachedConfirmation = (
  status: {
    confirmationStatus?: "processed" | "confirmed" | "finalized" | null;
  },
  commitment: "processed" | "confirmed" | "finalized"
): boolean => {
  if (commitment === "processed") {
    return true;
  }
  if (commitment === "confirmed") {
    return status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized";
  }
  return status.confirmationStatus === "finalized";
};

/**
 * Check signature status and return receipt if confirmed.
 */
const checkSignatureStatus = (
  rpc: Effect.Effect.Success<ReturnType<RpcServiceShape["getRpc"]>>,
  signature: Signature,
  commitment: "processed" | "confirmed" | "finalized"
): Effect.Effect<TransactionReceipt | null, TransactionFailedError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      catch: (cause) =>
        new TransactionFailedError({
          cause,
          logs: [],
          message: "Failed to get signature status",
          signature,
        }),
      try: () => rpc.getSignatureStatuses([signature]).send(),
    });

    const status = response?.value?.[0];
    if (!status) {
      return null;
    }

    if (status.err) {
      return yield* Effect.fail(
        new TransactionFailedError({
          logs: [],
          message: "Transaction failed on-chain",
          signature,
        })
      );
    }

    if (hasReachedConfirmation(status, commitment)) {
      return {
        confirmations: status.confirmations !== null ? BigInt(status.confirmations) : null,
        signature,
        slot: BigInt(status.slot),
      };
    }

    return null;
  });

const buildComputeBudgetInstructions = (config?: ComputeBudgetConfig): readonly Instruction[] => {
  if (!config) {
    return [];
  }

  const instructions: Instruction[] = [];

  if (config.unitLimit !== undefined) {
    instructions.push(getSetComputeUnitLimitInstruction({ units: config.unitLimit }));
  }

  if (config.microLamports !== undefined) {
    instructions.push(getSetComputeUnitPriceInstruction({ microLamports: config.microLamports }));
  }

  return instructions;
};

/**
 * Create a TransactionService layer.
 *
 * @category Layers
 */
export const TransactionServiceLive = Layer.effect(
  TransactionService,
  Effect.gen(function* () {
    const rpcService = yield* RpcService;
    const signerService = yield* SignerService;

    const service: TransactionServiceShape = {
      build: (instructions, opts) =>
        Effect.gen(function* () {
          const rpc = yield* rpcService.getRpc();
          const address = yield* signerService.getAddress();
          const computeBudgetInstructions = buildComputeBudgetInstructions(opts?.computeBudget);

          // Get latest blockhash
          const { value: latestBlockhash } = yield* Effect.tryPromise({
            catch: (cause) =>
              new TransactionSendError({
                cause,
                message: "Failed to get latest blockhash",
              }),
            try: () => rpc.getLatestBlockhash().send(),
          });

          // Build transaction message
          const message = pipe(
            createTransactionMessage({ version: 0 }),
            (m) => setTransactionMessageFeePayer(address, m),
            (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
            (m) =>
              appendTransactionMessageInstructions(
                [...computeBudgetInstructions, ...instructions],
                m
              )
          );

          return message;
        }).pipe(Effect.withSpan(SpanNames.TX_BUILD)),

      confirm: (signature, opts) =>
        Effect.gen(function* () {
          const rpc = yield* rpcService.getRpc();
          const commitment = opts?.commitment ?? "confirmed";
          const timeout = opts?.timeout ?? 60_000;

          // Poll for confirmation with retry logic
          const pollEffect = checkSignatureStatus(rpc, signature, commitment).pipe(
            Effect.flatMap((receipt) =>
              receipt ? Effect.succeed(receipt) : Effect.fail("not-confirmed")
            )
          );

          // Retry with spaced intervals until timeout
          const retrySchedule = Schedule.spaced("2 seconds");

          return yield* pollEffect.pipe(
            Effect.retry(retrySchedule),
            Effect.timeout(`${timeout} millis`),
            Effect.catchTag("TimeoutException", () =>
              Effect.fail(
                new TransactionTimeoutError({
                  message: `Transaction confirmation timed out after ${timeout}ms`,
                  signature,
                })
              )
            ),
            Effect.catchAll(
              (error): Effect.Effect<never, TransactionFailedError | TransactionTimeoutError> => {
                // Let TransactionFailedError propagate
                if (error instanceof TransactionFailedError) {
                  return Effect.fail(error);
                }
                // Convert "not-confirmed" string to TransactionTimeoutError
                return Effect.fail(
                  new TransactionTimeoutError({
                    message: `Transaction confirmation timed out after ${timeout}ms`,
                    signature,
                  })
                );
              }
            )
          );
        }).pipe(Effect.withSpan(SpanNames.TX_CONFIRM)),

      send: (tx) =>
        Effect.gen(function* () {
          const rpc = yield* rpcService.getRpc();
          const signature = getSignatureFromTransaction(tx);

          const wireTransaction = getBase64EncodedWireTransaction(tx);

          yield* Effect.tryPromise({
            catch: (cause) =>
              new TransactionSendError({
                cause,
                message: "Failed to send transaction",
                signature,
              }),
            try: () =>
              rpc
                .sendTransaction(wireTransaction, { encoding: "base64", skipPreflight: false })
                .send(),
          });

          return signature;
        }).pipe(Effect.withSpan(SpanNames.TX_SEND)),

      sendAll: (txs, opts) =>
        Effect.gen(function* () {
          const retries = opts?.sendRetries ?? 0;
          const retryDelay = opts?.sendRetryDelay ?? 500;

          const sendWithRetry = (tx: Transaction & TransactionWithLifetime) => {
            const sendEffect = service.send(tx);

            if (retries <= 0) {
              return sendEffect;
            }

            const retrySchedule = pipe(
              Schedule.recurs(retries),
              Schedule.addDelay(() => Duration.millis(retryDelay))
            );

            return sendEffect.pipe(Effect.retry(retrySchedule));
          };

          return yield* Effect.forEach(
            txs,
            (tx) => sendWithRetry(tx),
            opts?.concurrency ? { concurrency: opts.concurrency } : undefined
          );
        }).pipe(Effect.withSpan(SpanNames.TX_SEND)),

      sendAndConfirm: (instructions, opts) =>
        Effect.gen(function* () {
          const tx = yield* service.build(instructions, {
            computeBudget: opts?.computeBudget,
          });
          const signed = yield* service.sign(tx);
          const signature = yield* service.send(signed);
          return yield* service.confirm(signature, opts);
        }).pipe(Effect.withSpan(SpanNames.TX_SEND_AND_CONFIRM)),

      sendAndConfirmBatch: (items, opts) =>
        Effect.gen(function* () {
          const built = yield* Effect.forEach(
            items,
            (item) => service.build(item.instructions, { computeBudget: item.computeBudget }),
            opts?.concurrency ? { concurrency: opts.concurrency } : undefined
          );

          const signed = yield* service.signAll(built);
          const signatures = yield* service.sendAll(signed, opts);

          return yield* Effect.forEach(
            signatures,
            (signature) => service.confirm(signature, opts?.confirm),
            opts?.concurrency ? { concurrency: opts.concurrency } : undefined
          );
        }).pipe(Effect.withSpan(SpanNames.TX_SEND_AND_CONFIRM)),

      sign: (tx) =>
        Effect.gen(function* () {
          const compiled = compileTransaction(tx);
          // Cast to the expected type for signTransaction
          const typed = compiled as unknown as Transaction & TransactionWithLifetime;
          return yield* signerService
            .signTransaction(typed)
            .pipe(
              Effect.mapError((error) =>
                error instanceof SignatureError
                  ? new TransactionSendError({ cause: error, message: error.message })
                  : error
              )
            );
        }).pipe(Effect.withSpan(SpanNames.TX_SIGN)),

      signAll: (txs) =>
        Effect.gen(function* () {
          const compiled = txs.map(
            (tx) => compileTransaction(tx) as Transaction & TransactionWithLifetime
          );
          return (yield* signerService
            .signAllTransactions(compiled)
            .pipe(
              Effect.mapError((error) =>
                error instanceof SignatureError
                  ? new TransactionSendError({ cause: error, message: error.message })
                  : error
              )
            )) as readonly (Transaction & TransactionWithLifetime)[];
        }).pipe(Effect.withSpan(SpanNames.TX_SIGN)),

      simulate: (tx) =>
        Effect.gen(function* () {
          const rpc = yield* rpcService.getRpc();
          const compiled = compileTransaction(tx);
          // Cast to the expected type for signTransaction
          const typed = compiled as unknown as Transaction & TransactionWithLifetime;
          const signed = yield* signerService
            .signTransaction(typed)
            .pipe(
              Effect.mapError((error) =>
                error instanceof SignatureError
                  ? new TransactionSendError({ cause: error, message: error.message })
                  : error
              )
            );

          const wireTransaction = getBase64EncodedWireTransaction(signed);

          const result = yield* Effect.tryPromise({
            catch: (cause) =>
              new SimulationFailedError({
                cause,
                message: "Simulation failed",
              }),
            try: () => rpc.simulateTransaction(wireTransaction, { encoding: "base64" }).send(),
          });

          if (result.value.err) {
            return yield* Effect.fail(
              new SimulationFailedError({
                logs: result.value.logs ?? [],
                message: "Simulation failed with error",
              })
            );
          }
        }).pipe(Effect.withSpan(SpanNames.TX_SIMULATE)),
    };

    return TransactionService.of(service);
  })
);
