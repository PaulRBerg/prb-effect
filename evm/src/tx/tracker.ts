import { Effect, SubscriptionRef } from "effect";
import type {
  AccessList,
  Hash,
  PublicClient,
  TransactionReceipt,
  TransactionType,
  WalletClient,
} from "viem";
import { MIN_TX_GAS } from "#src/constants/index.js";
import type {
  ClientNotFoundError,
  TxReplacementReason,
  WalletNotConnectedError,
  WrongNetworkError,
} from "#src/core/index.js";
import { PublicClientService, TxFailedError, WalletClientService } from "#src/core/index.js";

export type TxRequestMeta = {
  readonly accessList?: AccessList | undefined;
  readonly gas?: bigint | undefined;
  readonly gasPrice?: bigint | undefined;
  readonly maxFeePerGas?: bigint | undefined;
  readonly maxPriorityFeePerGas?: bigint | undefined;
  readonly nonce?: number | bigint | undefined;
  readonly type?: TransactionType | undefined;
};

export type TxFailedPhase = "preflight" | "submission" | "receipt" | "event-decode";

export type TxPreflightWarning = {
  readonly phase: "estimate" | "simulate";
  readonly reason?: string | undefined;
  readonly customErrorName?: string | undefined;
};

type TxStateBase = {
  readonly tx?: TxRequestMeta | undefined;
  readonly preflightWarning?: TxPreflightWarning | undefined;
};

export type TxState =
  | (TxStateBase & { status: "idle" })
  | (TxStateBase & { status: "simulating" })
  | (TxStateBase & {
      status: "estimated";
      gas: bigint;
    })
  | (TxStateBase & { status: "signing" })
  | (TxStateBase & {
      status: "submitted";
      hash: Hash;
    })
  | (TxStateBase & {
      status: "pending";
      hash: Hash;
      confirmations: number;
    })
  | (TxStateBase & {
      status: "queued";
      reference?: string | undefined;
      reason?: string | undefined;
      details?: Readonly<Record<string, unknown>> | undefined;
    })
  | (TxStateBase & {
      status: "cancelled";
      reference?: string | undefined;
      reason?: string | undefined;
      details?: Readonly<Record<string, unknown>> | undefined;
    })
  | (TxStateBase & {
      status: "mined";
      hash: Hash;
      receipt: TransactionReceipt;
      effectiveGasPrice?: bigint | undefined;
    })
  | (TxStateBase & {
      status: "replaced";
      oldHash: Hash;
      newHash: Hash;
      reason: TxReplacementReason;
    })
  | (TxStateBase & {
      status: "failed";
      error: TxFailedError;
      phase: TxFailedPhase;
    });

export const initialTxState: TxState = { status: "idle" };

function isNotNullish<T>(value: T): value is NonNullable<T> {
  return value != null;
}

/** Create a TxState tracker with subscription capabilities */
export const makeTxTracker = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make<TxState>(initialTxState);

  return {
    changes: SubscriptionRef.changes(ref),
    get: SubscriptionRef.get(ref),
    ref,
    set: (state: TxState) => SubscriptionRef.set(ref, state),
    update: (f: (s: TxState) => TxState) => SubscriptionRef.update(ref, f),
  };
});

/** Fetch a transaction by hash, failing if not found */
const getOriginalTx = (publicClient: PublicClient, hash: Hash) =>
  Effect.tryPromise({
    catch: (cause) =>
      new TxFailedError({ cause, hash, message: `Failed to get transaction ${hash}` }),
    try: () => publicClient.getTransaction({ hash }),
  }).pipe(
    Effect.filterOrFail(
      isNotNullish,
      () => new TxFailedError({ hash, message: `Transaction ${hash} not found` })
    )
  );

/**
 * Speed up a pending transaction by submitting a replacement with higher gas fees
 * @param chainId - Chain ID for the wallet client
 * @param hash - Original transaction hash
 * @param newMaxFeePerGas - New max fee per gas (must be higher than original)
 * @param newMaxPriorityFeePerGas - New max priority fee per gas (optional)
 * @returns Effect that resolves to the new transaction hash
 */
export const speedupTx = (
  chainId: number,
  hash: Hash,
  newMaxFeePerGas: bigint,
  newMaxPriorityFeePerGas?: bigint
): Effect.Effect<
  Hash,
  TxFailedError | WalletNotConnectedError | WrongNetworkError | ClientNotFoundError,
  PublicClientService | WalletClientService
> =>
  Effect.gen(function* () {
    const walletClientService = yield* WalletClientService;
    const walletClient = yield* walletClientService.get(chainId);
    const publicClientService = yield* PublicClientService;
    const publicClient = yield* publicClientService.get(chainId);

    const transaction = yield* getOriginalTx(publicClient as PublicClient, hash);

    // Create replacement transaction with same nonce but higher fees
    const newHash = yield* Effect.tryPromise({
      catch: (cause) =>
        new TxFailedError({
          cause,
          hash,
          message: `Failed to speed up transaction ${hash}`,
        }),
      try: () =>
        (walletClient as WalletClient).sendTransaction({
          account: transaction.from,
          chain: null,
          data: transaction.input,
          gas: transaction.gas ?? undefined,
          maxFeePerGas: newMaxFeePerGas,
          maxPriorityFeePerGas:
            newMaxPriorityFeePerGas ?? transaction.maxPriorityFeePerGas ?? undefined,
          nonce: transaction.nonce,
          to: transaction.to ?? undefined,
          value: transaction.value,
        }),
    });

    return newHash;
  });

/**
 * Cancel a pending transaction by submitting a zero-value replacement to self
 * @param chainId - Chain ID for the wallet client
 * @param hash - Original transaction hash
 * @param newMaxFeePerGas - New max fee per gas (must be higher than original)
 * @returns Effect that resolves to the cancellation transaction hash
 */
export const cancelTx = (
  chainId: number,
  hash: Hash,
  newMaxFeePerGas: bigint,
  newMaxPriorityFeePerGas?: bigint
): Effect.Effect<
  Hash,
  TxFailedError | WalletNotConnectedError | WrongNetworkError | ClientNotFoundError,
  PublicClientService | WalletClientService
> =>
  Effect.gen(function* () {
    const walletClientService = yield* WalletClientService;
    const walletClient = yield* walletClientService.get(chainId);
    const publicClientService = yield* PublicClientService;
    const publicClient = yield* publicClientService.get(chainId);

    const transaction = yield* getOriginalTx(publicClient as PublicClient, hash);

    // Create cancellation transaction: same nonce, zero value to self, higher fees
    const newHash = yield* Effect.tryPromise({
      catch: (cause) =>
        new TxFailedError({
          cause,
          hash,
          message: `Failed to cancel transaction ${hash}`,
        }),
      try: () =>
        (walletClient as WalletClient).sendTransaction({
          account: transaction.from,
          chain: null,
          data: "0x",
          gas: MIN_TX_GAS, // Standard transfer gas
          maxFeePerGas: newMaxFeePerGas,
          maxPriorityFeePerGas:
            newMaxPriorityFeePerGas ?? transaction.maxPriorityFeePerGas ?? undefined,
          nonce: transaction.nonce,
          to: transaction.from, // Send to self
          value: 0n, // Zero value
        }),
    });

    return newHash;
  });
