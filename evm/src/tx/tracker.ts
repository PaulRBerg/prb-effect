import { Effect, SubscriptionRef } from "effect";
import type {
  AccessList,
  Hash,
  PublicClient,
  Transaction,
  TransactionReceipt,
  TransactionType,
  WalletClient,
} from "viem";
import { MIN_TX_GAS } from "@/src/constants/index.js";
import type {
  ClientNotFoundError,
  TransactionReplacementReason,
  WalletNotConnectedError,
  WrongNetworkError,
} from "@/src/core/index.js";
import {
  PublicClientService,
  TransactionFailedError,
  WalletClientService,
} from "@/src/core/index.js";

export type TxRequestMeta = {
  readonly accessList?: AccessList | undefined;
  readonly gas?: bigint | undefined;
  readonly gasPrice?: bigint | undefined;
  readonly maxFeePerGas?: bigint | undefined;
  readonly maxPriorityFeePerGas?: bigint | undefined;
  readonly nonce?: number | bigint | undefined;
  readonly type?: TransactionType | undefined;
};

export type TxState =
  | ({ readonly tx?: TxRequestMeta | undefined } & { status: "idle" })
  | ({ readonly tx?: TxRequestMeta | undefined } & { status: "simulating" })
  | ({ readonly tx?: TxRequestMeta | undefined } & {
      status: "estimated";
      gas: bigint;
    })
  | ({ readonly tx?: TxRequestMeta | undefined } & { status: "signing" })
  | ({ readonly tx?: TxRequestMeta | undefined } & {
      status: "submitted";
      hash: Hash;
    })
  | ({ readonly tx?: TxRequestMeta | undefined } & {
      status: "pending";
      hash: Hash;
      confirmations: number;
    })
  | ({ readonly tx?: TxRequestMeta | undefined } & {
      status: "mined";
      hash: Hash;
      receipt: TransactionReceipt;
      effectiveGasPrice?: bigint | undefined;
    })
  | ({ readonly tx?: TxRequestMeta | undefined } & {
      status: "replaced";
      oldHash: Hash;
      newHash: Hash;
      reason: TransactionReplacementReason;
    })
  | ({ readonly tx?: TxRequestMeta | undefined } & {
      status: "failed";
      error: TransactionFailedError;
    });

export const initialTxState: TxState = { status: "idle" };

/** Create a TxState tracker with subscription capabilities */
export const makeTxTracker = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make<TxState>(initialTxState);

  return {
    changes: ref.changes,
    get: SubscriptionRef.get(ref),
    ref,
    set: (state: TxState) => SubscriptionRef.set(ref, state),
    update: (f: (s: TxState) => TxState) => SubscriptionRef.update(ref, f),
  };
});

/**
 * Speed up a pending transaction by submitting a replacement with higher gas fees
 * @param chainId - Chain ID for the wallet client
 * @param hash - Original transaction hash
 * @param newMaxFeePerGas - New max fee per gas (must be higher than original)
 * @param newMaxPriorityFeePerGas - New max priority fee per gas (optional)
 * @returns Effect that resolves to the new transaction hash
 */
export const speedupTransaction = (
  chainId: number,
  hash: Hash,
  newMaxFeePerGas: bigint,
  newMaxPriorityFeePerGas?: bigint
): Effect.Effect<
  Hash,
  TransactionFailedError | WalletNotConnectedError | WrongNetworkError | ClientNotFoundError,
  PublicClientService | WalletClientService
> =>
  Effect.gen(function* () {
    const walletClientService = yield* WalletClientService;
    const walletClient = yield* walletClientService.get(chainId);
    const publicClientService = yield* PublicClientService;
    const publicClient = yield* publicClientService.get(chainId);

    // Get original transaction
    const tx = yield* Effect.tryPromise({
      catch: (cause) =>
        new TransactionFailedError({
          cause,
          hash,
          message: `Failed to get transaction ${hash}`,
        }),
      try: () => (publicClient as PublicClient).getTransaction({ hash }),
    });

    if (!tx) {
      yield* Effect.fail(
        new TransactionFailedError({
          hash,
          message: `Transaction ${hash} not found`,
        })
      );
    }

    const transaction = tx as Transaction;

    // Create replacement transaction with same nonce but higher fees
    const newHash = yield* Effect.tryPromise({
      catch: (cause) =>
        new TransactionFailedError({
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
export const cancelTransaction = (
  chainId: number,
  hash: Hash,
  newMaxFeePerGas: bigint,
  newMaxPriorityFeePerGas?: bigint
): Effect.Effect<
  Hash,
  TransactionFailedError | WalletNotConnectedError | WrongNetworkError | ClientNotFoundError,
  PublicClientService | WalletClientService
> =>
  Effect.gen(function* () {
    const walletClientService = yield* WalletClientService;
    const walletClient = yield* walletClientService.get(chainId);
    const publicClientService = yield* PublicClientService;
    const publicClient = yield* publicClientService.get(chainId);

    // Get original transaction
    const tx = yield* Effect.tryPromise({
      catch: (cause) =>
        new TransactionFailedError({
          cause,
          hash,
          message: `Failed to get transaction ${hash}`,
        }),
      try: () => (publicClient as PublicClient).getTransaction({ hash }),
    });

    if (!tx) {
      yield* Effect.fail(
        new TransactionFailedError({
          hash,
          message: `Transaction ${hash} not found`,
        })
      );
    }

    const transaction = tx as Transaction;

    // Create cancellation transaction: same nonce, zero value to self, higher fees
    const newHash = yield* Effect.tryPromise({
      catch: (cause) =>
        new TransactionFailedError({
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
