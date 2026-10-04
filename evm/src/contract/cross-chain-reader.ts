import { Context, Effect, Layer } from "effect";
import type { Abi, Address, ContractFunctionArgs } from "viem";
import type { ClientNotFoundError, ContractReadError, MulticallError } from "#src/core/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import type {
  ContractFunctionName,
  ContractFunctionReturnType,
  MulticallCall,
  MulticallResult,
  ReadParams,
} from "#src/types/index.js";
import { ContractReader } from "./reader.js";

type ArgsField<TArgs> = {
  readonly args?: TArgs | undefined;
} & (readonly [] extends TArgs ? unknown : { readonly args: TArgs });

export type CrossChainCall<
  TAbi extends Abi = Abi,
  TFunctionName extends ContractFunctionName<TAbi, "pure" | "view"> = ContractFunctionName<
    TAbi,
    "pure" | "view"
  >,
> = {
  readonly abi: TAbi;
  readonly address: Address;
  readonly chainId: number;
  readonly functionName: TFunctionName;
} & ArgsField<ContractFunctionArgs<TAbi, "pure" | "view", TFunctionName>>;

export type ReadSameParams<
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">,
> = {
  readonly abi: TAbi;
  readonly address: Address;
  readonly chainIds: readonly number[];
  readonly functionName: TFunctionName;
} & ArgsField<ContractFunctionArgs<TAbi, "pure" | "view", TFunctionName>>;

export type ChainMulticallBatch = {
  readonly chainId: number;
  readonly calls: readonly MulticallCall[];
};

export type CrossChainReaderShape = {
  /**
   * Execute reads across multiple chains in parallel.
   * Groups calls by chainId internally for efficiency.
   */
  readonly readAll: <const TCalls extends readonly CrossChainCall[]>(
    calls: TCalls
  ) => Effect.Effect<Map<number, unknown[]>, ContractReadError | ClientNotFoundError>;

  /**
   * Execute the same read on multiple chains (e.g., check balance on all chains)
   */
  readonly readSame: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">,
  >(
    params: ReadSameParams<TAbi, TFunctionName>
  ) => Effect.Effect<
    Map<number, ContractFunctionReturnType<TAbi, "pure" | "view", TFunctionName>>,
    ContractReadError | ClientNotFoundError
  >;

  /**
   * Execute multicall on each chain in parallel, then merge results
   */
  readonly multicallAll: <const TBatches extends readonly ChainMulticallBatch[]>(
    batches: TBatches
  ) => Effect.Effect<
    Map<number, readonly MulticallResult<unknown>[]>,
    MulticallError | ClientNotFoundError
  >;
};

export class CrossChainReader extends Context.Service<CrossChainReader, CrossChainReaderShape>()(
  "ew3/CrossChainReader"
) {}

/**
 * Helper function to group items by a key
 */
const groupBy = <T, K extends string | number>(
  arr: readonly T[],
  keyFn: (item: T) => K
): Map<K, T[]> => {
  const result = new Map<K, T[]>();
  for (const item of arr) {
    const key = keyFn(item);
    const group = result.get(key) ?? [];
    group.push(item);
    result.set(key, group);
  }
  return result;
};

/**
 * Live implementation of CrossChainReader service
 */
export const CrossChainReaderLive = Layer.effect(
  CrossChainReader,
  Effect.gen(function* () {
    const reader = yield* ContractReader;

    return CrossChainReader.of({
      multicallAll: <const TBatches extends readonly ChainMulticallBatch[]>(batches: TBatches) =>
        Effect.gen(function* () {
          // Execute multicalls for each chain in parallel
          const results = yield* Effect.all(
            batches.map((batch) =>
              reader.multicall(batch.chainId, batch.calls).pipe(
                Effect.map((result) => ({
                  chainId: batch.chainId,
                  result,
                }))
              )
            ),
            { concurrency: "unbounded" }
          );

          // Collect results into a Map by chainId
          const resultMap = new Map<number, readonly MulticallResult<unknown>[]>();
          for (const { chainId, result } of results) {
            resultMap.set(chainId, result);
          }

          return resultMap;
        }).pipe(
          Effect.withSpan(SpanNames.CROSS_CHAIN_MULTICALL_ALL, {
            attributes: {
              batchCount: batches.length,
              chainIds: batches.map((b) => b.chainId),
            },
          })
        ),

      readAll: <const TCalls extends readonly CrossChainCall[]>(calls: TCalls) =>
        Effect.gen(function* () {
          // Group calls by chainId
          const groupedCalls = groupBy(calls, (call) => call.chainId);

          // Execute reads for each chain in parallel
          const results = yield* Effect.all(
            Array.from(groupedCalls.entries()).map(([chainId, chainCalls]) =>
              Effect.all(
                chainCalls.map((call) => reader.read(call)),
                { concurrency: "unbounded" }
              ).pipe(
                Effect.map((chainResults) => ({
                  chainId,
                  results: chainResults,
                }))
              )
            ),
            { concurrency: "unbounded" }
          );

          // Collect results into a Map by chainId
          const resultMap = new Map<number, unknown[]>();
          for (const { chainId, results: chainResults } of results) {
            resultMap.set(chainId, chainResults);
          }

          return resultMap;
        }).pipe(
          Effect.withSpan(SpanNames.CROSS_CHAIN_READ_ALL, {
            attributes: {
              callCount: calls.length,
              chainIds: Array.from(new Set(calls.map((c) => c.chainId))),
            },
          })
        ),

      readSame: <
        TAbi extends Abi,
        TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">,
      >(
        params: ReadSameParams<TAbi, TFunctionName>
      ) =>
        Effect.gen(function* () {
          // Execute the same read on each chain in parallel
          const results = yield* Effect.all(
            params.chainIds.map((chainId) =>
              reader
                .read({
                  abi: params.abi,
                  address: params.address,
                  args: params.args,
                  chainId,
                  functionName: params.functionName,
                } as ReadParams<TAbi, TFunctionName>)
                .pipe(
                  Effect.map((result) => ({
                    chainId,
                    result: result as ContractFunctionReturnType<
                      TAbi,
                      "pure" | "view",
                      TFunctionName
                    >,
                  }))
                )
            ),
            { concurrency: "unbounded" }
          );

          // Collect results into a Map by chainId
          const resultMap = new Map<
            number,
            ContractFunctionReturnType<TAbi, "pure" | "view", TFunctionName>
          >();
          for (const { chainId, result } of results) {
            resultMap.set(chainId, result);
          }

          return resultMap;
        }).pipe(
          Effect.withSpan(SpanNames.CROSS_CHAIN_READ_SAME, {
            attributes: {
              address: params.address,
              chainCount: params.chainIds.length,
              chainIds: params.chainIds,
              functionName: params.functionName,
            },
          })
        ),
    });
  })
);
