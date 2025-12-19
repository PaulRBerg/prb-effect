import type { Abi, ContractFunctionName, ContractFunctionReturnType } from "viem";

export type {
  Abi,
  AbiEvent,
  AbiFunction,
  ContractEventArgs,
  ContractEventName,
  ContractFunctionArgs,
  ContractFunctionName,
  ContractFunctionReturnType,
} from "viem";

/**
 * Extract readable function names from ABI
 */
export type ReadFunctionName<TAbi extends Abi> = ContractFunctionName<TAbi, "pure" | "view">;

/**
 * Extract writable function names from ABI
 */
export type WriteFunctionName<TAbi extends Abi> = ContractFunctionName<
  TAbi,
  "nonpayable" | "payable"
>;

/**
 * Extract the return type from a multicall call
 */
export type ExtractMulticallReturnType<TCall> = TCall extends {
  readonly abi: infer TAbi;
  readonly functionName: infer TFunctionName;
}
  ? TAbi extends Abi
    ? TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">
      ? ContractFunctionReturnType<TAbi, "pure" | "view", TFunctionName>
      : unknown
    : unknown
  : unknown;

/**
 * Map an array of multicall calls to their corresponding result types
 */
export type MulticallResultTypes<TCalls extends readonly unknown[]> = TCalls extends readonly [
  infer TFirst,
  ...infer TRest,
]
  ? readonly [ExtractMulticallReturnType<TFirst>, ...MulticallResultTypes<TRest>]
  : readonly [];
