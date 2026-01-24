import type {
  Abi,
  Address,
  BlockTag,
  ContractFunctionArgs,
  ContractFunctionName,
  GetValue,
  Hash,
  TransactionReceipt,
} from "viem";
import type { TxOverrides } from "@/src/types/index.js";

type ValueField<TAbi extends Abi, TFunctionName extends string> = Readonly<
  GetValue<TAbi, TFunctionName, bigint>
>;

type ArgsField<TArgs> = {
  readonly args?: TArgs | undefined;
} & (readonly [] extends TArgs ? unknown : { readonly args: TArgs });

type BlockRef =
  | {
      readonly blockNumber?: bigint | undefined;
      readonly blockTag?: never;
    }
  | {
      readonly blockNumber?: never;
      readonly blockTag?: BlockTag | undefined;
    }
  | {
      readonly blockNumber?: never;
      readonly blockTag?: never;
    };

/**
 * Parameters for reading from a contract
 */
export type ReadParams<
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">,
> = {
  /** Optional call account (msg.sender) */
  readonly account?: Address | undefined;
  readonly chainId: number;
  readonly address: Address;
  readonly abi: TAbi;
  readonly functionName: TFunctionName;
} & BlockRef &
  ArgsField<ContractFunctionArgs<TAbi, "pure" | "view", TFunctionName>>;

/**
 * Parameters for writing to a contract
 */
export type WriteParams<
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
> = {
  readonly chainId: number;
  readonly address: Address;
  readonly abi: TAbi;
  readonly functionName: TFunctionName;
  readonly account: Address;
  /** Legacy escape hatch. Prefer `overrides.gas`. */
  readonly gas?: bigint | undefined;
  /** Safe transaction-level overrides (fees, nonce, access list, etc). */
  readonly overrides?: TxOverrides | undefined;
} & ArgsField<ContractFunctionArgs<TAbi, "nonpayable" | "payable", TFunctionName>> &
  ValueField<TAbi, TFunctionName>;

/**
 * Result from simulating a contract call
 */
export type SimulateResult<TResult = unknown> = {
  readonly result: TResult;
  readonly request: unknown;
};

/**
 * A single call in a multicall batch
 */
export type MulticallCall<
  TAbi extends Abi = Abi,
  TFunctionName extends ContractFunctionName<TAbi, "pure" | "view"> = ContractFunctionName<
    TAbi,
    "pure" | "view"
  >,
> = {
  readonly address: Address;
  readonly abi: TAbi;
  readonly functionName: TFunctionName;
} & ArgsField<ContractFunctionArgs<TAbi, "pure" | "view", TFunctionName>>;

/**
 * Result from a multicall operation
 */
export type MulticallResult<TResult = unknown> =
  | { readonly status: "success"; readonly result: TResult }
  | { readonly status: "failure"; readonly error: Error };

/**
 * Result from a transaction
 */
export type TxResult = {
  readonly hash: Hash;
  readonly receipt: TransactionReceipt;
};
