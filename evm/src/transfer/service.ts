import { Context, Effect, Layer } from "effect";
import type { Address, Hash, TransactionReceipt, WalletClient } from "viem";
import { MIN_TX_GAS } from "@/src/constants/index.js";
import type { ClientNotFoundError, WrongNetworkError } from "@/src/core/index.js";
import {
  InsufficientFundsError,
  isInsufficientFunds,
  isUserRejection,
  PublicClientService,
  ReceiptTimeoutError,
  TxFailedError,
  UserRejectedError,
  WalletClientService,
  WalletNotConnectedError,
} from "@/src/core/index.js";

export type TransferOverrides = {
  readonly gas?: bigint;
  readonly gasPrice?: bigint;
  readonly maxFeePerGas?: bigint;
  readonly maxPriorityFeePerGas?: bigint;
  readonly nonce?: number;
};

export type TransferServiceShape = {
  readonly send: (params: {
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

  readonly sendAndWait: (params: {
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

  readonly estimateGas: (params: {
    chainId: number;
    to: Address;
    value: bigint;
  }) => Effect.Effect<bigint, ClientNotFoundError>;
};

export class TransferService extends Context.Tag("ew3/TransferService")<
  TransferService,
  TransferServiceShape
>() {}

/**
 * Classify transfer errors into appropriate error types
 */
const classifyTransferError = (
  error: unknown,
  to: Address
): InsufficientFundsError | UserRejectedError | TxFailedError => {
  if (isUserRejection(error)) {
    return new UserRejectedError({
      message: error instanceof Error ? error.message : "User rejected the transaction",
    });
  }

  if (isInsufficientFunds(error)) {
    return new InsufficientFundsError({
      available: "0",
      message: error instanceof Error ? error.message : "Insufficient funds for transfer",
      required: "0",
    });
  }

  return new TxFailedError({
    cause: error,
    hash: "0x",
    message: error instanceof Error ? error.message : `Failed to send transfer to ${to}`,
  });
};

export const TransferServiceLive = Layer.effect(
  TransferService,
  Effect.gen(function* () {
    const walletClientService = yield* WalletClientService;
    const publicClientService = yield* PublicClientService;

    return TransferService.of({
      estimateGas: Effect.fn("TransferService.estimateGas")(function* (params) {
        const publicClient = yield* publicClientService.get(params.chainId);

        // Try to estimate, fallback to standard transfer gas on failure
        return yield* Effect.tryPromise({
          catch: () => MIN_TX_GAS,
          try: () =>
            publicClient.estimateGas({
              to: params.to,
              value: params.value,
            }),
        }).pipe(Effect.catchAll(() => Effect.succeed(MIN_TX_GAS)));
      }),

      send: Effect.fn("TransferService.send")(function* (params) {
        const walletClient = yield* walletClientService.get(params.chainId);
        const [account] = yield* Effect.tryPromise({
          catch: () =>
            new WalletNotConnectedError({
              chainId: params.chainId,
              message: "No account found",
            }),
          try: () => walletClient.getAddresses(),
        });

        if (!account) {
          return yield* Effect.fail(
            new WalletNotConnectedError({
              chainId: params.chainId,
              message: "No account connected",
            })
          );
        }

        // Determine if we should use legacy or EIP-1559 transaction type
        const useLegacy = params.overrides?.gasPrice !== undefined;

        return yield* Effect.tryPromise({
          catch: (error) => classifyTransferError(error, params.to),
          try: () =>
            useLegacy
              ? (walletClient as WalletClient).sendTransaction({
                  account,
                  chain: null,
                  gas: params.overrides?.gas,
                  gasPrice: params.overrides?.gasPrice,
                  nonce: params.overrides?.nonce,
                  to: params.to,
                  type: "legacy",
                  value: params.value,
                })
              : (walletClient as WalletClient).sendTransaction({
                  account,
                  chain: null,
                  gas: params.overrides?.gas,
                  maxFeePerGas: params.overrides?.maxFeePerGas,
                  maxPriorityFeePerGas: params.overrides?.maxPriorityFeePerGas,
                  nonce: params.overrides?.nonce,
                  to: params.to,
                  type: "eip1559",
                  value: params.value,
                }),
        });
      }),

      sendAndWait: Effect.fn("TransferService.sendAndWait")(function* (params) {
        const walletClient = yield* walletClientService.get(params.chainId);
        const publicClient = yield* publicClientService.get(params.chainId);
        const [account] = yield* Effect.tryPromise({
          catch: () =>
            new WalletNotConnectedError({
              chainId: params.chainId,
              message: "No account found",
            }),
          try: () => walletClient.getAddresses(),
        });

        if (!account) {
          return yield* Effect.fail(
            new WalletNotConnectedError({
              chainId: params.chainId,
              message: "No account connected",
            })
          );
        }

        // Determine if we should use legacy or EIP-1559 transaction type
        const useLegacy = params.overrides?.gasPrice !== undefined;

        const hash = yield* Effect.tryPromise({
          catch: (error) => classifyTransferError(error, params.to),
          try: () =>
            useLegacy
              ? (walletClient as WalletClient).sendTransaction({
                  account,
                  chain: null,
                  gas: params.overrides?.gas,
                  gasPrice: params.overrides?.gasPrice,
                  nonce: params.overrides?.nonce,
                  to: params.to,
                  type: "legacy",
                  value: params.value,
                })
              : (walletClient as WalletClient).sendTransaction({
                  account,
                  chain: null,
                  gas: params.overrides?.gas,
                  maxFeePerGas: params.overrides?.maxFeePerGas,
                  maxPriorityFeePerGas: params.overrides?.maxPriorityFeePerGas,
                  nonce: params.overrides?.nonce,
                  to: params.to,
                  type: "eip1559",
                  value: params.value,
                }),
        });

        return yield* Effect.tryPromise({
          catch: (error) => {
            if (error instanceof Error && error.message.includes("timeout")) {
              return new ReceiptTimeoutError({
                hash,
                message: `Transaction receipt timeout for ${hash}`,
                timeout: 30_000,
              });
            }
            return new TxFailedError({
              cause: error,
              hash,
              message: `Failed to wait for transaction ${hash}`,
            });
          },
          try: () =>
            publicClient.waitForTransactionReceipt({
              confirmations: params.confirmations,
              hash,
            }),
        });
      }),
    });
  })
);
