import { Context, Effect, Layer } from "effect";
import type { Hash, PublicClient, Transaction } from "viem";
import { MIN_TX_GAS } from "#src/constants/index.js";
import type {
  ClientNotFoundError,
  WalletNotConnectedError,
  WrongNetworkError,
} from "#src/core/index.js";
import { PublicClientService, TxFailedError, WalletClientService } from "#src/core/index.js";
import type { GasPriceUnavailableError } from "#src/gas/index.js";
import { GasService } from "#src/gas/index.js";
import { bumpByPercent } from "#src/internal/index.js";
import type { TxPolicy } from "#src/tx/index.js";

export type TxReplacementShape = {
  readonly speedup: (
    chainId: number,
    hash: Hash,
    policy?: TxPolicy
  ) => Effect.Effect<
    Hash,
    | TxFailedError
    | WalletNotConnectedError
    | WrongNetworkError
    | ClientNotFoundError
    | GasPriceUnavailableError
  >;

  readonly cancel: (
    chainId: number,
    hash: Hash,
    policy?: TxPolicy
  ) => Effect.Effect<
    Hash,
    | TxFailedError
    | WalletNotConnectedError
    | WrongNetworkError
    | ClientNotFoundError
    | GasPriceUnavailableError
  >;
};

export class TxReplacement extends Context.Service<TxReplacement, TxReplacementShape>()(
  "ew3/TxReplacement"
) {}

const cap = (value: bigint, max: bigint | undefined): bigint =>
  max !== undefined && value > max ? max : value;

type FeeBump =
  | { type: "legacy"; gasPrice: bigint }
  | {
      type: "eip1559";
      maxFeePerGas: bigint;
      maxPriorityFeePerGas?: bigint | undefined;
    };

const computeFeeBump = (params: {
  tx: Transaction;
  estimate: {
    gasPrice?: bigint | undefined;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  };
  policy?: TxPolicy | undefined;
}): FeeBump => {
  const tx = params.tx;
  const estimate = params.estimate;
  const policy = params.policy;

  const looksEip1559 =
    tx.type === "eip1559" || tx.maxFeePerGas !== undefined || tx.maxPriorityFeePerGas !== undefined;

  if (!looksEip1559) {
    const oldGasPrice = tx.gasPrice ?? estimate.gasPrice ?? estimate.maxFeePerGas;
    const candidateGasPrice = bumpByPercent(oldGasPrice, 1250n);
    const estimatedGasPrice = estimate.gasPrice ?? estimate.maxFeePerGas;
    const gasPrice = cap(
      candidateGasPrice > estimatedGasPrice ? candidateGasPrice : estimatedGasPrice,
      policy?.maxFeePerGas
    );

    return { gasPrice, type: "legacy" };
  }

  const oldMaxFee = tx.maxFeePerGas ?? estimate.maxFeePerGas;
  const oldPriority = tx.maxPriorityFeePerGas ?? estimate.maxPriorityFeePerGas;

  const candidateMaxFee = bumpByPercent(oldMaxFee, 1250n);
  const candidatePriority = bumpByPercent(oldPriority, 1250n);

  const maxFeePerGas = cap(
    candidateMaxFee > estimate.maxFeePerGas ? candidateMaxFee : estimate.maxFeePerGas,
    policy?.maxFeePerGas
  );
  const maxPriorityFeePerGas = cap(
    candidatePriority > estimate.maxPriorityFeePerGas
      ? candidatePriority
      : estimate.maxPriorityFeePerGas,
    policy?.maxPriorityFeePerGas
  );

  return { maxFeePerGas, maxPriorityFeePerGas, type: "eip1559" };
};

const sendReplacement = (params: {
  action: "cancel" | "speedup";
  chainId: number;
  hash: Hash;
  tx: Transaction;
  bump: FeeBump;
}): Effect.Effect<
  Hash,
  TxFailedError | WalletNotConnectedError | WrongNetworkError | ClientNotFoundError,
  WalletClientService
> =>
  Effect.gen(function* () {
    const walletClientService = yield* WalletClientService;
    const walletClient = yield* walletClientService.get(params.chainId);

    return yield* Effect.tryPromise({
      catch: (cause) =>
        new TxFailedError({
          cause,
          hash: params.hash,
          message: `Failed to ${params.action} transaction ${params.hash}`,
        }),
      try: () => {
        const base = {
          account: params.tx.from,
          chain: null,
          data: params.action === "cancel" ? "0x" : (params.tx.input ?? "0x"),
          gas: params.action === "cancel" ? MIN_TX_GAS : (params.tx.gas ?? undefined),
          nonce: params.tx.nonce,
          to: params.action === "cancel" ? params.tx.from : (params.tx.to ?? undefined),
          value: params.action === "cancel" ? 0n : params.tx.value,
        };

        if (params.bump.type === "legacy") {
          return walletClient.sendTransaction({
            ...base,
            gasPrice: params.bump.gasPrice,
            type: "legacy",
          });
        }

        return walletClient.sendTransaction({
          ...base,
          maxFeePerGas: params.bump.maxFeePerGas,
          maxPriorityFeePerGas: params.bump.maxPriorityFeePerGas,
          type: "eip1559",
        });
      },
    });
  });

const computeBump = (
  tx: Transaction,
  estimate: {
    gasPrice?: bigint | undefined;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  },
  policy?: TxPolicy
): FeeBump => computeFeeBump({ estimate, policy, tx });

export const TxReplacementLive = Layer.effect(
  TxReplacement,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;
    const walletClientService = yield* WalletClientService;
    const gasService = yield* GasService;

    const getTx = (chainId: number, hash: Hash) =>
      Effect.gen(function* () {
        const client = yield* publicClientService.get(chainId);
        const tx = yield* Effect.tryPromise({
          catch: (cause) =>
            new TxFailedError({
              cause,
              hash,
              message: `Failed to get transaction ${hash}`,
            }),
          try: () => (client as PublicClient).getTransaction({ hash }),
        });
        return tx as Transaction;
      });

    return TxReplacement.of({
      cancel: (chainId, hash, policy) =>
        Effect.gen(function* () {
          const tx = yield* getTx(chainId, hash);
          const estimate = yield* gasService.estimateFees({
            chainId,
            speed: policy?.feeSpeed,
          });

          const bump = computeBump(tx, estimate, policy);
          return yield* sendReplacement({
            action: "cancel",
            bump,
            chainId,
            hash,
            tx,
          }).pipe(Effect.provideService(WalletClientService, walletClientService));
        }),

      speedup: (chainId, hash, policy) =>
        Effect.gen(function* () {
          const tx = yield* getTx(chainId, hash);
          const estimate = yield* gasService.estimateFees({
            chainId,
            speed: policy?.feeSpeed,
          });

          const bump = computeBump(tx, estimate, policy);
          return yield* sendReplacement({
            action: "speedup",
            bump,
            chainId,
            hash,
            tx,
          }).pipe(Effect.provideService(WalletClientService, walletClientService));
        }),
    });
  })
);
