import { Context, Effect, Layer } from "effect";
import type {
  Abi,
  Address,
  Chain,
  ContractFunctionArgs,
  EstimateContractGasParameters,
  Hash,
  SimulateContractParameters,
  WriteContractParameters,
} from "viem";
import { encodeFunctionData } from "viem";
import type {
  ClientNotFoundError,
  ContractReadError,
  ContractWriteError,
  GasEstimationError,
  InsufficientFundsError,
  ResourceExhaustionError,
  SimulationFailedError,
  TransactionSubmissionError,
  UserRejectedError,
  WalletNotConnectedError,
  WrongNetworkError,
} from "#src/core/index.js";
import {
  classifyContractError,
  classifyGasEstimationError,
  classifyWriteError,
  PublicClientService,
  WalletClientService,
} from "#src/core/index.js";
import type { ContractFunctionName, SimulateResult, WriteParams } from "#src/types/index.js";

const txRequestOverridesFromWriteParams = <
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
>(
  params: WriteParams<TAbi, TFunctionName>
) => {
  const overrides = params.overrides;
  return {
    accessList: overrides?.accessList,
    gas: overrides?.gas ?? params.gas,
    gasPrice: overrides?.gasPrice,
    maxFeePerGas: overrides?.maxFeePerGas,
    maxPriorityFeePerGas: overrides?.maxPriorityFeePerGas,
    nonce: overrides?.nonce,
    type: overrides?.type,
  };
};

const tryEncodeCalldata = <
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
>(
  params: WriteParams<TAbi, TFunctionName>
): string | undefined => {
  try {
    return encodeFunctionData({
      abi: params.abi as Abi,
      args: params.args as readonly unknown[] | undefined,
      functionName: params.functionName as string,
    });
  } catch {
    // Ignore encoding errors, calldata is optional context.
    return undefined;
  }
};

const txErrorContextFromWriteParams = <
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
>(
  params: WriteParams<TAbi, TFunctionName>,
  calldata: string | undefined
) => ({
  address: params.address,
  calldata,
  functionName: params.functionName as string,
  sender: params.account,
  value: params.value?.toString(),
});

/**
 * Service for writing to smart contracts
 */
export type ContractWriterShape = {
  /**
   * Simulate a contract call before executing it
   */
  readonly simulate: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(
    params: WriteParams<TAbi, TFunctionName>
  ) => Effect.Effect<
    SimulateResult,
    | SimulationFailedError
    | ContractReadError
    | InsufficientFundsError
    | ResourceExhaustionError
    | UserRejectedError
    | ClientNotFoundError
  >;

  /**
   * Estimate gas for a contract call
   */
  readonly estimateGas: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(
    params: WriteParams<TAbi, TFunctionName>
  ) => Effect.Effect<
    bigint,
    | GasEstimationError
    | InsufficientFundsError
    | ResourceExhaustionError
    | UserRejectedError
    | ClientNotFoundError
  >;

  /**
   * Write to a contract function (submits transaction)
   */
  readonly write: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(
    params: WriteParams<TAbi, TFunctionName>
  ) => Effect.Effect<
    Hash,
    | ContractWriteError
    | InsufficientFundsError
    | ResourceExhaustionError
    | TransactionSubmissionError
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
  >;
};

export class ContractWriter extends Context.Service<ContractWriter, ContractWriterShape>()(
  "ew3/ContractWriter"
) {}

/**
 * Live implementation of ContractWriter service
 */
export const ContractWriterLive = Layer.effect(
  ContractWriter,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;
    const walletClientService = yield* WalletClientService;

    return ContractWriter.of({
      estimateGas: Effect.fn("ContractWriter.estimateGas")(function* <
        TAbi extends Abi,
        TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
      >(params: WriteParams<TAbi, TFunctionName>) {
        const publicClient = yield* publicClientService.get(params.chainId);

        return yield* Effect.tryPromise({
          catch: (cause) => {
            const calldata = tryEncodeCalldata(params);
            return classifyGasEstimationError(
              cause,
              txErrorContextFromWriteParams(params, calldata)
            );
          },
          try: () =>
            publicClient.estimateContractGas({
              abi: params.abi,
              account: params.account,
              address: params.address,
              args: params.args,
              functionName: params.functionName,
              value: params.value,
              ...txRequestOverridesFromWriteParams(params),
            } as EstimateContractGasParameters<TAbi, TFunctionName>),
        });
      }),
      simulate: Effect.fn("ContractWriter.simulate")(function* <
        TAbi extends Abi,
        TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
      >(params: WriteParams<TAbi, TFunctionName>) {
        const publicClient = yield* publicClientService.get(params.chainId);

        return yield* Effect.tryPromise({
          catch: (cause) => {
            const calldata = tryEncodeCalldata(params);
            return classifyContractError(cause, txErrorContextFromWriteParams(params, calldata));
          },
          try: async () => {
            const result = await publicClient.simulateContract({
              abi: params.abi,
              account: params.account,
              address: params.address,
              args: params.args,
              functionName: params.functionName,
              value: params.value,
              ...txRequestOverridesFromWriteParams(params),
            } as SimulateContractParameters<
              TAbi,
              TFunctionName,
              ContractFunctionArgs<TAbi, "nonpayable" | "payable", TFunctionName>,
              Chain | undefined,
              Chain | undefined,
              Address
            >);
            return {
              request: result.request,
              result: result.result,
            };
          },
        });
      }),

      write: Effect.fn("ContractWriter.write")(function* <
        TAbi extends Abi,
        TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
      >(params: WriteParams<TAbi, TFunctionName>) {
        const walletClient = yield* walletClientService.get(params.chainId);

        return yield* Effect.tryPromise({
          catch: (cause) => {
            const calldata = tryEncodeCalldata(params);
            return classifyWriteError(cause, txErrorContextFromWriteParams(params, calldata));
          },
          try: () =>
            walletClient.writeContract({
              abi: params.abi,
              account: params.account,
              address: params.address,
              args: params.args,
              chain: walletClient.chain,
              functionName: params.functionName,
              value: params.value,
              ...txRequestOverridesFromWriteParams(params),
            } as WriteContractParameters<TAbi, TFunctionName>),
        });
      }),
    });
  })
);
