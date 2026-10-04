import { Context, Effect, Layer } from "effect";
import type { Address, Hash, TransactionReceipt, WalletClient } from "viem";
import { MIN_TX_GAS } from "#src/constants/index.js";
import type { ClientNotFoundError, WrongNetworkError } from "#src/core/index.js";
import {
  InsufficientFundsError,
  isInsufficientFunds,
  isResourceExhaustion,
  isUserRejection,
  PublicClientService,
  ReceiptTimeoutError,
  ResourceExhaustionError,
  TxFailedError,
  UserRejectedError,
  WalletClientService,
  WalletNotConnectedError,
} from "#src/core/index.js";
import type { GasPriceUnavailableError } from "#src/gas/index.js";
import { GasService } from "#src/gas/index.js";
import { deriveFeeOverrides, deriveTxType } from "#src/tx/index.js";
import type { TxOverrides } from "#src/types/index.js";

export type TransferOverrides = TxOverrides;

export type TransferServiceShape = {
  readonly send: (params: {
    chainId: number;
    to: Address;
    value: bigint;
    overrides?: TransferOverrides;
  }) => Effect.Effect<
    Hash,
    | InsufficientFundsError
    | ResourceExhaustionError
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
    | ClientNotFoundError
    | TxFailedError
    | GasPriceUnavailableError
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
    | ResourceExhaustionError
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
    | ClientNotFoundError
    | TxFailedError
    | ReceiptTimeoutError
    | GasPriceUnavailableError
  >;

  readonly estimateGas: (params: {
    chainId: number;
    to: Address;
    value: bigint;
  }) => Effect.Effect<bigint, ClientNotFoundError>;
};

export class TransferService extends Context.Service<TransferService, TransferServiceShape>()(
  "ew3/TransferService"
) {}

/**
 * Classify transfer errors into appropriate error types
 */
const classifyTransferError = (
  error: unknown,
  to: Address
): InsufficientFundsError | ResourceExhaustionError | UserRejectedError | TxFailedError => {
  if (isUserRejection(error)) {
    return new UserRejectedError({
      message: error instanceof Error ? error.message : "User rejected the transaction",
    });
  }

  if (isInsufficientFunds(error)) {
    return new InsufficientFundsError({
      message: error instanceof Error ? error.message : "Insufficient funds for transfer",
    });
  }

  if (isResourceExhaustion(error)) {
    return new ResourceExhaustionError({
      cause: error,
      message: "Device ran out of memory during transfer",
    });
  }

  return new TxFailedError({
    cause: error,
    hash: "0x",
    message: error instanceof Error ? error.message : `Failed to send transfer to ${to}`,
  });
};

const toViemNonce = (nonce: number | bigint | undefined): number | undefined =>
  nonce === undefined ? undefined : Number(nonce);

export const TransferServiceLive = Layer.effect(
  TransferService,
  Effect.gen(function* () {
    const walletClientService = yield* WalletClientService;
    const publicClientService = yield* PublicClientService;
    const gasService = yield* GasService;

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
        }).pipe(Effect.catch(() => Effect.succeed(MIN_TX_GAS)));
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

        // Get derived tx type and fees
        const txType = yield* deriveTxType({
          chainId: params.chainId,
          userOverrides: params.overrides,
        }).pipe(Effect.provideService(GasService, gasService));

        const feeOverrides = yield* deriveFeeOverrides({
          chainId: params.chainId,
          userOverrides: params.overrides,
        }).pipe(Effect.provideService(GasService, gasService));

        const isLegacy = txType === "legacy";
        const nonce = toViemNonce(params.overrides?.nonce);

        return yield* Effect.tryPromise({
          catch: (error) => classifyTransferError(error, params.to),
          try: () =>
            isLegacy
              ? (walletClient as WalletClient).sendTransaction({
                  account,
                  chain: null,
                  gas: params.overrides?.gas,
                  gasPrice: feeOverrides.gasPrice,
                  nonce,
                  to: params.to,
                  type: "legacy",
                  value: params.value,
                })
              : (walletClient as WalletClient).sendTransaction({
                  account,
                  chain: null,
                  gas: params.overrides?.gas,
                  maxFeePerGas: feeOverrides.maxFeePerGas,
                  maxPriorityFeePerGas: feeOverrides.maxPriorityFeePerGas,
                  nonce,
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

        // Get derived tx type and fees
        const txType = yield* deriveTxType({
          chainId: params.chainId,
          userOverrides: params.overrides,
        }).pipe(Effect.provideService(GasService, gasService));

        const feeOverrides = yield* deriveFeeOverrides({
          chainId: params.chainId,
          userOverrides: params.overrides,
        }).pipe(Effect.provideService(GasService, gasService));

        const isLegacy = txType === "legacy";
        const nonce = toViemNonce(params.overrides?.nonce);

        const hash = yield* Effect.tryPromise({
          catch: (error) => classifyTransferError(error, params.to),
          try: () =>
            isLegacy
              ? (walletClient as WalletClient).sendTransaction({
                  account,
                  chain: null,
                  gas: params.overrides?.gas,
                  gasPrice: feeOverrides.gasPrice,
                  nonce,
                  to: params.to,
                  type: "legacy",
                  value: params.value,
                })
              : (walletClient as WalletClient).sendTransaction({
                  account,
                  chain: null,
                  gas: params.overrides?.gas,
                  maxFeePerGas: feeOverrides.maxFeePerGas,
                  maxPriorityFeePerGas: feeOverrides.maxPriorityFeePerGas,
                  nonce,
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
