import { Context, Effect, Layer } from "effect";
import type { Abi } from "viem";
import type { ClientNotFoundError } from "#src/core/index.js";
import {
  ContractReadError,
  extractRevertReason,
  MulticallError,
  PublicClientService,
} from "#src/core/index.js";
import type {
  ContractFunctionName,
  ContractFunctionReturnType,
  ExtractMulticallReturnType,
  MulticallCall,
  MulticallResult,
  ReadParams,
} from "#src/types/index.js";

/**
 * Service for reading from smart contracts
 */
export type ContractReaderShape = {
  /**
   * Read from a contract function
   */
  readonly read: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">,
  >(
    params: ReadParams<TAbi, TFunctionName>
  ) => Effect.Effect<
    ContractFunctionReturnType<TAbi, "pure" | "view", TFunctionName>,
    ContractReadError | ClientNotFoundError
  >;

  /**
   * Execute multiple contract reads in a single call with type-safe results.
   * Each call in the array preserves its ABI and function type information,
   * and the result is a tuple where each element is typed based on its corresponding call.
   *
   * @example
   * ```typescript
   * const results = yield* contractReader.multicall(1, [
   *   { address: tokenAddr, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] },
   *   { address: tokenAddr, abi: ERC20_ABI, functionName: "totalSupply" }
   * ]);
   * // results[0].result is typed as bigint (balanceOf return type)
   * // results[1].result is typed as bigint (totalSupply return type)
   * ```
   */
  readonly multicall: <const TCalls extends readonly MulticallCall[]>(
    chainId: number,
    calls: TCalls,
    options?: {
      readonly blockNumber?: bigint | undefined;
      readonly blockTag?: import("viem").BlockTag | undefined;
    }
  ) => Effect.Effect<
    {
      readonly [K in keyof TCalls]: MulticallResult<ExtractMulticallReturnType<TCalls[K]>>;
    },
    MulticallError | ClientNotFoundError
  >;
};

export class ContractReader extends Context.Service<ContractReader, ContractReaderShape>()(
  "ew3/ContractReader"
) {}

/**
 * Live implementation of ContractReader service
 */
export const ContractReaderLive = Layer.effect(
  ContractReader,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;

    return ContractReader.of({
      multicall: Effect.fn("ContractReader.multicall")(function* <
        const TCalls extends readonly MulticallCall[],
      >(
        chainId: number,
        calls: TCalls,
        options?: {
          readonly blockNumber?: bigint | undefined;
          readonly blockTag?: import("viem").BlockTag | undefined;
        }
      ) {
        const client = yield* publicClientService.get(chainId);

        const results = yield* Effect.tryPromise({
          catch: (cause) =>
            new MulticallError({
              cause,
              failedCalls: 0,
              message: "Multicall failed",
            }),
          try: () =>
            client.multicall({
              blockNumber: options?.blockNumber,
              blockTag: options?.blockTag,
              contracts: calls.map((c) => ({
                abi: c.abi,
                address: c.address,
                args: c.args,
                functionName: c.functionName,
              })),
            }),
        });

        return results.map((r) =>
          r.status === "success"
            ? { result: r.result, status: "success" as const }
            : {
                error: new Error(String(r.error)),
                status: "failure" as const,
              }
        ) as {
          readonly [K in keyof TCalls]: MulticallResult<ExtractMulticallReturnType<TCalls[K]>>;
        };
      }),
      read: Effect.fn("ContractReader.read")(function* <
        TAbi extends Abi,
        TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">,
      >(params: ReadParams<TAbi, TFunctionName>) {
        const client = yield* publicClientService.get(params.chainId);

        return yield* Effect.tryPromise({
          catch: (cause) => {
            const revertReason = extractRevertReason(cause);
            return new ContractReadError({
              address: params.address,
              cause,
              functionName: params.functionName as string,
              message: `Failed to read ${params.functionName as string} from ${params.address}${revertReason ? `: ${revertReason}` : ""}`,
            });
          },
          try: () =>
            client.readContract({
              abi: params.abi,
              account: params.account,
              address: params.address,
              args: params.args,
              blockNumber: params.blockNumber,
              blockTag: params.blockTag,
              functionName: params.functionName,
            }),
        });
      }),
    });
  })
);
