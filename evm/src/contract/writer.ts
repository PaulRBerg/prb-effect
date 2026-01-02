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
import type {
  ClientNotFoundError,
  ContractReadError,
  ContractWriteError,
  GasEstimationError,
  InsufficientFundsError,
  SimulationFailedError,
  UserRejectedError,
  WalletNotConnectedError,
  WrongNetworkError,
} from "@/src/core/index.js";
import {
  classifyContractError,
  classifyGasEstimationError,
  classifyWriteError,
  PublicClientService,
  WalletClientService,
} from "@/src/core/index.js";
import type { ContractFunctionName, SimulateResult, WriteParams } from "@/src/types/index.js";

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
    GasEstimationError | InsufficientFundsError | UserRejectedError | ClientNotFoundError
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
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
  >;
};

export class ContractWriter extends Context.Tag("ew3/ContractWriter")<
  ContractWriter,
  ContractWriterShape
>() {}

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
          catch: (cause) =>
            classifyGasEstimationError(cause, {
              address: params.address,
              functionName: params.functionName as string,
            }),
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
          catch: (cause) =>
            classifyContractError(cause, {
              address: params.address,
              functionName: params.functionName as string,
            }),
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
          catch: (cause) =>
            classifyWriteError(cause, {
              address: params.address,
              functionName: params.functionName as string,
            }),
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
