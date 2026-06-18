import type { Connection, TransactionInstruction, TransactionSignature } from "@solana/web3.js";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { Context, Duration, Effect, Layer, pipe, Schedule } from "effect";
import type { WalletNotConnectedError } from "#src/core/errors/index.js";
import {
  BlockhashExpiredError,
  SignatureError,
  SimulationFailedError,
  TransactionFailedError,
  TransactionSendError,
  TransactionTimeoutError,
} from "#src/core/errors/index.js";
import { RpcService } from "#src/rpc/index.js";
import { SignerService } from "#src/signer/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import type {
  ComputeBudgetConfig,
  ConfirmOpts,
  SignableTransactionMessage,
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
    instructions: readonly TransactionInstruction[],
    opts?: TransactionBuildOpts
  ) => Effect.Effect<SignableTransactionMessage, TransactionSendError | WalletNotConnectedError>;

  /**
   * Sign multiple transactions in a batch.
   */
  readonly signAll: (
    txs: readonly SignableTransactionMessage[]
  ) => Effect.Effect<readonly Transaction[], TransactionSendError | WalletNotConnectedError>;

  /**
   * Sign a transaction.
   */
  readonly sign: <T extends SignableTransactionMessage>(
    tx: T
  ) => Effect.Effect<T, TransactionSendError | WalletNotConnectedError>;

  /**
   * Send multiple signed transactions.
   */
  readonly sendAll: (
    txs: readonly Transaction[],
    opts?: TransactionBatchOpts
  ) => Effect.Effect<readonly TransactionSignature[], TransactionSendError>;

  /**
   * Send a signed transaction.
   */
  readonly send: (tx: Transaction) => Effect.Effect<TransactionSignature, TransactionSendError>;

  /**
   * Confirm a transaction by signature.
   */
  readonly confirm: (
    signature: TransactionSignature,
    opts?: ConfirmOpts
  ) => Effect.Effect<
    TransactionReceipt,
    TransactionTimeoutError | TransactionFailedError | BlockhashExpiredError
  >;

  /**
   * Build, sign, send, and confirm a transaction.
   */
  readonly sendAndConfirm: (
    instructions: readonly TransactionInstruction[],
    opts?: ConfirmOpts & { computeBudget?: ComputeBudgetConfig }
  ) => Effect.Effect<
    TransactionReceipt,
    | TransactionSendError
    | WalletNotConnectedError
    | TransactionTimeoutError
    | TransactionFailedError
    | BlockhashExpiredError
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
    | BlockhashExpiredError
  >;

  /**
   * Simulate a transaction.
   */
  readonly simulate: <T extends SignableTransactionMessage>(
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

type Commitment = "processed" | "confirmed" | "finalized";

type BlockhashLifetime = {
  readonly blockhash: string;
  readonly lastValidBlockHeight: number;
};

const transactionLifetimes = new WeakMap<Transaction, BlockhashLifetime>();

const hasReachedConfirmation = (
  status: {
    readonly confirmationStatus?: Commitment | null;
  },
  commitment: Commitment
): boolean => {
  if (commitment === "processed") {
    return true;
  }
  if (commitment === "confirmed") {
    return status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized";
  }
  return status.confirmationStatus === "finalized";
};

const checkSignatureStatus = (
  connection: Connection,
  signature: TransactionSignature,
  commitment: Commitment,
  searchTransactionHistory: boolean
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
      try: () => connection.getSignatureStatuses([signature], { searchTransactionHistory }),
    });

    const status = response.value[0];
    if (!status) {
      return null;
    }

    if (status.err) {
      return yield* Effect.fail(
        new TransactionFailedError({
          cause: status.err,
          logs: [],
          message: "Transaction failed on-chain",
          signature,
        })
      );
    }

    if (hasReachedConfirmation(status, commitment)) {
      return {
        confirmations: status.confirmations === null ? null : BigInt(status.confirmations),
        signature,
        slot: BigInt(status.slot),
      };
    }

    return null;
  });

const getExpiredAt = (
  connection: Connection,
  signature: TransactionSignature,
  commitment: Commitment,
  opts: ConfirmOpts,
  expiredAt: number | null
): Effect.Effect<number | null, TransactionFailedError> =>
  Effect.gen(function* () {
    if (!opts.lifetime || expiredAt !== null) {
      return expiredAt;
    }

    const blockHeight = yield* Effect.tryPromise({
      catch: (cause) =>
        new TransactionFailedError({
          cause,
          logs: [],
          message: "Failed to get block height",
          signature,
        }),
      try: () => connection.getBlockHeight(commitment),
    });

    return blockHeight <= Number(opts.lifetime.lastValidBlockHeight) ? null : Date.now();
  });

const hasExceededExpiredGracePeriod = (
  opts: ConfirmOpts,
  expiredAt: number,
  now: number
): boolean => {
  const gracePeriod = opts.lifetime?.expiredStatusGracePeriod ?? "30 seconds";
  return now - expiredAt >= Duration.toMillis(gracePeriod);
};

const withBuiltBlockhashLifetime = (tx: Transaction, opts?: ConfirmOpts): ConfirmOpts => {
  if (opts?.lifetime) {
    return opts;
  }

  const lifetime = transactionLifetimes.get(tx);
  return lifetime ? { ...opts, lifetime } : (opts ?? {});
};

const pollForConfirmation = (
  connection: Connection,
  signature: TransactionSignature,
  opts: ConfirmOpts,
  expiredAt: number | null = null
): Effect.Effect<TransactionReceipt, TransactionFailedError | BlockhashExpiredError> =>
  Effect.gen(function* () {
    const commitment = opts.commitment ?? "confirmed";
    const searchTransactionHistory = opts.searchTransactionHistory ?? true;
    const pollInterval = opts.pollInterval ?? "2 seconds";

    const receipt = yield* checkSignatureStatus(
      connection,
      signature,
      commitment,
      searchTransactionHistory
    );
    if (receipt) {
      return receipt;
    }

    const nextExpiredAt = yield* getExpiredAt(connection, signature, commitment, opts, expiredAt);
    if (opts.lifetime && nextExpiredAt !== null) {
      const now = Date.now();
      if (hasExceededExpiredGracePeriod(opts, nextExpiredAt, now)) {
        return yield* Effect.fail(
          new BlockhashExpiredError({
            blockhash: opts.lifetime.blockhash,
            message: "Transaction blockhash expired before confirmation",
          })
        );
      }
    }

    yield* Effect.sleep(pollInterval);
    return yield* pollForConfirmation(connection, signature, opts, nextExpiredAt);
  });

const buildComputeBudgetInstructions = (
  config?: ComputeBudgetConfig
): readonly TransactionInstruction[] => {
  if (!config) {
    return [];
  }

  const instructions: TransactionInstruction[] = [];

  if (config.unitLimit !== undefined) {
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: config.unitLimit }));
  }

  if (config.microLamports !== undefined) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: config.microLamports })
    );
  }

  return instructions;
};

const mapSignatureError = (error: SignatureError | WalletNotConnectedError) =>
  error instanceof SignatureError
    ? new TransactionSendError({ cause: error, message: error.message })
    : error;

const cloneLifetime = (from: Transaction, to: Transaction): void => {
  const lifetime = transactionLifetimes.get(from);
  if (lifetime && from !== to) {
    transactionLifetimes.set(to, lifetime);
  }
};

const makeTransactionService = (
  rpcService: { readonly getRpc: () => Effect.Effect<Connection> },
  signerService: {
    readonly getAddress: () => Effect.Effect<string, WalletNotConnectedError>;
    readonly signTransaction: <T extends Transaction>(
      tx: T
    ) => Effect.Effect<T, SignatureError | WalletNotConnectedError>;
    readonly signAllTransactions: <T extends Transaction>(
      txs: readonly T[]
    ) => Effect.Effect<readonly T[], SignatureError | WalletNotConnectedError>;
  }
): TransactionServiceShape => {
  const service: TransactionServiceShape = {
    build: (instructions, opts) =>
      Effect.gen(function* () {
        const connection = yield* rpcService.getRpc();
        const address = yield* signerService.getAddress();
        const computeBudgetInstructions = buildComputeBudgetInstructions(opts?.computeBudget);

        const latestBlockhash = yield* Effect.tryPromise({
          catch: (cause) =>
            new TransactionSendError({
              cause,
              message: "Failed to get latest blockhash",
            }),
          try: () => connection.getLatestBlockhash(),
        });

        const transaction = new Transaction({
          feePayer: new PublicKey(address),
          recentBlockhash: latestBlockhash.blockhash,
        }).add(...computeBudgetInstructions, ...instructions);

        transactionLifetimes.set(transaction, latestBlockhash);
        return transaction;
      }).pipe(Effect.withSpan(SpanNames.TX_BUILD)),

    confirm: (signature, opts) =>
      Effect.gen(function* () {
        const connection = yield* rpcService.getRpc();
        const timeout = opts?.timeout ?? 60_000;

        return yield* pollForConfirmation(connection, signature, opts ?? {}).pipe(
          Effect.timeout(`${timeout} millis`),
          Effect.catchTag("TimeoutException", () =>
            Effect.fail(
              new TransactionTimeoutError({
                message: `Transaction confirmation timed out after ${timeout}ms`,
                signature,
              })
            )
          )
        );
      }).pipe(Effect.withSpan(SpanNames.TX_CONFIRM)),

    send: (tx) =>
      Effect.gen(function* () {
        const connection = yield* rpcService.getRpc();
        return yield* Effect.tryPromise({
          catch: (cause) =>
            new TransactionSendError({
              cause,
              message: "Failed to send transaction",
            }),
          try: () => connection.sendRawTransaction(tx.serialize(), { skipPreflight: false }),
        });
      }).pipe(Effect.withSpan(SpanNames.TX_SEND)),

    sendAll: (txs, opts) =>
      Effect.gen(function* () {
        const retries = opts?.sendRetries ?? 0;
        const retryDelay = opts?.sendRetryDelay ?? 500;

        const sendWithRetry = (tx: Transaction) => {
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
        return yield* service.confirm(signature, withBuiltBlockhashLifetime(signed, opts));
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
          signed,
          (tx, index) =>
            Effect.gen(function* () {
              const signature = signatures[index];
              if (!signature) {
                return yield* Effect.fail(
                  new TransactionSendError({
                    message: "sendAll returned fewer signatures than transactions",
                  })
                );
              }

              return yield* service.confirm(
                signature,
                withBuiltBlockhashLifetime(tx, opts?.confirm)
              );
            }),
          opts?.concurrency ? { concurrency: opts.concurrency } : undefined
        );
      }).pipe(Effect.withSpan(SpanNames.TX_SEND_AND_CONFIRM)),

    sign: (tx) =>
      Effect.gen(function* () {
        const signed = yield* signerService
          .signTransaction(tx)
          .pipe(Effect.mapError(mapSignatureError));
        cloneLifetime(tx, signed);
        return signed;
      }).pipe(Effect.withSpan(SpanNames.TX_SIGN)),

    signAll: (txs) =>
      Effect.gen(function* () {
        const signed = yield* signerService
          .signAllTransactions(txs)
          .pipe(Effect.mapError(mapSignatureError));
        txs.forEach((tx, index) => {
          const signedTx = signed[index];
          if (signedTx) {
            cloneLifetime(tx, signedTx);
          }
        });
        return signed;
      }).pipe(Effect.withSpan(SpanNames.TX_SIGN)),

    simulate: (tx) =>
      Effect.gen(function* () {
        const connection = yield* rpcService.getRpc();
        const signed = yield* signerService
          .signTransaction(tx)
          .pipe(Effect.mapError(mapSignatureError));
        cloneLifetime(tx, signed);

        const result = yield* Effect.tryPromise({
          catch: (cause) =>
            new SimulationFailedError({
              cause,
              message: "Simulation failed",
            }),
          try: () => connection.simulateTransaction(signed),
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

  return service;
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

    return TransactionService.of(makeTransactionService(rpcService, signerService));
  })
);
