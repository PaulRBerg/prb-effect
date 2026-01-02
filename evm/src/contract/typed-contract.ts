import { Effect } from "effect";
import type { Address, BlockTag, GetValue, Hash } from "viem";
import { ContractReader, ContractWriter } from "@/src/contract/index.js";
import type {
  Abi,
  ContractFunctionArgs,
  ContractFunctionReturnType,
  ReadFunctionName,
  ReadParams,
  SimulateResult,
  TxOverrides,
  WriteFunctionName,
  WriteParams,
} from "@/src/types/index.js";

type ReadArgs<
  TAbi extends Abi,
  TFunctionName extends ReadFunctionName<TAbi>,
> = ContractFunctionArgs<TAbi, "pure" | "view", TFunctionName>;

type ReadCallOptions = {
  readonly account?: Address | undefined;
  readonly blockNumber?: bigint | undefined;
  readonly blockTag?: BlockTag | undefined;
};

type ReadArgsWithOptionsParam<
  TAbi extends Abi,
  TFunctionName extends ReadFunctionName<TAbi>,
> = readonly [] extends ReadArgs<TAbi, TFunctionName>
  ? [args?: ReadArgs<TAbi, TFunctionName>, options?: ReadCallOptions | undefined]
  : [args: ReadArgs<TAbi, TFunctionName>, options?: ReadCallOptions | undefined];

type WriteArgs<
  TAbi extends Abi,
  TFunctionName extends WriteFunctionName<TAbi>,
> = ContractFunctionArgs<TAbi, "nonpayable" | "payable", TFunctionName>;

type WriteArgsField<
  TAbi extends Abi,
  TFunctionName extends WriteFunctionName<TAbi>,
> = readonly [] extends WriteArgs<TAbi, TFunctionName>
  ? { readonly args?: WriteArgs<TAbi, TFunctionName> | undefined }
  : { readonly args: WriteArgs<TAbi, TFunctionName> };

type WriteOverrides<TAbi extends Abi, TFunctionName extends WriteFunctionName<TAbi>> = {
  readonly account: Address;
  readonly overrides?: TxOverrides | undefined;
  readonly gas?: bigint | undefined;
} & WriteArgsField<TAbi, TFunctionName> &
  GetValue<TAbi, TFunctionName, bigint>;

/**
 * A typed contract instance with the ABI baked in
 */
export type TypedContract<TAbi extends Abi> = {
  /**
   * The contract address
   */
  readonly address: Address;

  /**
   * The contract ABI
   */
  readonly abi: TAbi;

  /**
   * Read from a contract function
   */
  readonly read: <TFunctionName extends ReadFunctionName<TAbi>>(
    chainId: number,
    functionName: TFunctionName,
    ...args: ReadArgsWithOptionsParam<TAbi, TFunctionName>
  ) => Effect.Effect<
    ContractFunctionReturnType<TAbi, "pure" | "view", TFunctionName>,
    Error,
    ContractReader
  >;

  /**
   * Simulate a contract write
   */
  readonly simulate: <TFunctionName extends WriteFunctionName<TAbi>>(
    chainId: number,
    functionName: TFunctionName,
    args: WriteOverrides<TAbi, TFunctionName>
  ) => Effect.Effect<SimulateResult, Error, ContractWriter>;

  /**
   * Estimate gas for a contract write
   */
  readonly estimateGas: <TFunctionName extends WriteFunctionName<TAbi>>(
    chainId: number,
    functionName: TFunctionName,
    args: WriteOverrides<TAbi, TFunctionName>
  ) => Effect.Effect<bigint, Error, ContractWriter>;

  /**
   * Write to a contract function
   */
  readonly write: <TFunctionName extends WriteFunctionName<TAbi>>(
    chainId: number,
    functionName: TFunctionName,
    args: WriteOverrides<TAbi, TFunctionName>
  ) => Effect.Effect<Hash, Error, ContractWriter>;
};

/**
 * Creates a typed contract instance with ABI baked in
 *
 * @example
 * ```typescript
 * const erc20 = typedContract(erc20Abi, "0x...")
 *
 * // Type-safe reads
 * const balance = await erc20.read(1, "balanceOf", ["0x..."])
 *
 * // Type-safe writes
 * const hash = await erc20.write(1, "transfer", {
 *   args: ["0x...", 100n],
 *   account: "0x...",
 * })
 * ```
 */
export function typedContract<TAbi extends Abi>(abi: TAbi, address: Address): TypedContract<TAbi> {
  return {
    abi,
    address,

    estimateGas: <TFunctionName extends WriteFunctionName<TAbi>>(
      chainId: number,
      functionName: TFunctionName,
      params: WriteOverrides<TAbi, TFunctionName>
    ) =>
      Effect.gen(function* () {
        const writer = yield* ContractWriter;
        return yield* writer.estimateGas({
          abi,
          address,
          chainId,
          functionName,
          ...params,
        } as WriteParams<TAbi, TFunctionName>);
      }),

    read: <TFunctionName extends ReadFunctionName<TAbi>>(
      chainId: number,
      functionName: TFunctionName,
      ...args: ReadArgsWithOptionsParam<TAbi, TFunctionName>
    ) =>
      Effect.gen(function* () {
        const reader = yield* ContractReader;
        const options = args[1];
        return yield* reader.read({
          abi,
          account: options?.account,
          address,
          args: args[0],
          blockNumber: options?.blockNumber,
          blockTag: options?.blockTag,
          chainId,
          functionName,
        } as ReadParams<TAbi, TFunctionName>);
      }),

    simulate: <TFunctionName extends WriteFunctionName<TAbi>>(
      chainId: number,
      functionName: TFunctionName,
      params: WriteOverrides<TAbi, TFunctionName>
    ) =>
      Effect.gen(function* () {
        const writer = yield* ContractWriter;
        return yield* writer.simulate({
          abi,
          address,
          chainId,
          functionName,
          ...params,
        } as WriteParams<TAbi, TFunctionName>);
      }),

    write: <TFunctionName extends WriteFunctionName<TAbi>>(
      chainId: number,
      functionName: TFunctionName,
      params: WriteOverrides<TAbi, TFunctionName>
    ) =>
      Effect.gen(function* () {
        const writer = yield* ContractWriter;
        return yield* writer.write({
          abi,
          address,
          chainId,
          functionName,
          ...params,
        } as WriteParams<TAbi, TFunctionName>);
      }),
  };
}
