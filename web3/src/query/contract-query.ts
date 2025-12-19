import type { Stream } from "effect";
import { Context, Effect, Layer } from "effect";
import type { Abi, ContractFunctionName } from "viem";
import type { ClientNotFoundError, ContractReadError, MulticallError } from "@/src/core/index.js";
import { ContractReadError as ContractReadErrorClass } from "@/src/core/index.js";
import { ChainHead } from "@/src/query/chain-head.js";
import { QueryClient } from "@/src/query/client.js";
import { MulticallBatcher } from "@/src/query/multicall-batcher.js";
import type { ContractFunctionReturnType, MulticallCall, ReadParams } from "@/src/types/index.js";

export type ContractQueryReadOptions = {
  readonly ttl?: number | undefined;
  readonly blockScoped?: boolean | undefined;
};

export type ContractQueryWatchOptions = ContractQueryReadOptions & {
  readonly refetchOn?: Stream.Stream<unknown, never> | undefined;
};

export type ContractQueryShape = {
  readonly read: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">,
  >(
    params: ReadParams<TAbi, TFunctionName>,
    options?: ContractQueryReadOptions | undefined
  ) => Effect.Effect<
    ContractFunctionReturnType<TAbi, "pure" | "view", TFunctionName>,
    ContractReadError | MulticallError | ClientNotFoundError
  >;

  readonly watchRead: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">,
  >(
    params: ReadParams<TAbi, TFunctionName>,
    options?: ContractQueryWatchOptions | undefined
  ) => Effect.Effect<
    Stream.Stream<
      ContractFunctionReturnType<TAbi, "pure" | "view", TFunctionName>,
      ContractReadError | MulticallError | ClientNotFoundError
    >,
    ClientNotFoundError
  >;
};

export class ContractQuery extends Context.Tag("ew3/ContractQuery")<
  ContractQuery,
  ContractQueryShape
>() {}

const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));

const stableKey = (params: ReadParams<Abi, string>): string => {
  const args = params.args ?? [];
  return [
    "contractRead",
    params.chainId,
    params.address,
    params.account ?? "no-account",
    String(params.functionName),
    params.blockNumber?.toString() ?? "no-block-number",
    params.blockTag ?? "no-block-tag",
    stableStringify(args),
    stableStringify(params.abi),
  ].join(":");
};

const normalizeReadError = (
  params: ReadParams<Abi, string>,
  cause: unknown
): ContractReadError | MulticallError | ClientNotFoundError => {
  const anyCause = cause as { _tag?: string } | null;
  if (anyCause && typeof anyCause === "object" && "_tag" in anyCause) {
    const tag = anyCause._tag;
    if (tag === "ClientNotFoundError" || tag === "MulticallError") {
      return cause as ClientNotFoundError | MulticallError;
    }
  }

  const message = cause instanceof Error ? cause.message : String(cause);
  return new ContractReadErrorClass({
    address: params.address,
    cause,
    functionName: params.functionName as string,
    message,
  });
};

export const ContractQueryLive = Layer.effect(
  ContractQuery,
  Effect.gen(function* () {
    const queryClient = yield* QueryClient;
    const chainHead = yield* ChainHead;
    const batcher = yield* MulticallBatcher;

    const read = <
      TAbi extends Abi,
      TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">,
    >(
      params: ReadParams<TAbi, TFunctionName>,
      options?: ContractQueryReadOptions | undefined
    ) => {
      const key = stableKey(params as unknown as ReadParams<Abi, string>);
      const call = {
        abi: params.abi,
        address: params.address,
        args: params.args as unknown as MulticallCall["args"],
        functionName: params.functionName,
      } satisfies MulticallCall;

      const effect = batcher
        .enqueue<ContractFunctionReturnType<TAbi, "pure" | "view", TFunctionName>>(
          params.chainId,
          call,
          {
            blockNumber: params.blockNumber,
            blockTag: params.blockTag,
          }
        )
        .pipe(
          Effect.mapError((cause) =>
            normalizeReadError(params as unknown as ReadParams<Abi, string>, cause)
          )
        );

      return queryClient.query(key, effect, {
        blockScoped: options?.blockScoped ?? true,
        chainId: params.chainId,
        ttl: options?.ttl,
      });
    };

    const watchRead = <
      TAbi extends Abi,
      TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">,
    >(
      params: ReadParams<TAbi, TFunctionName>,
      options?: ContractQueryWatchOptions | undefined
    ) =>
      Effect.gen(function* () {
        const refetchOn = options?.refetchOn ?? (yield* chainHead.watch(params.chainId));
        const key = stableKey(params as unknown as ReadParams<Abi, string>);

        const effect = read(params, options);
        return queryClient.watch(key, effect, {
          blockScoped: options?.blockScoped ?? true,
          chainId: params.chainId,
          refetchOn,
          ttl: options?.ttl,
        });
      });

    return ContractQuery.of({ read, watchRead });
  })
);
