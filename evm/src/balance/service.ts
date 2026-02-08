import { Context, Effect, Layer, Stream } from "effect";
import type { Address, Hex } from "viem";
import { erc20Abi, erc20Abi_bytes32 } from "@/src/abi/index.js";
import type { ContractReaderShape } from "@/src/contract/index.js";
import { ContractReader } from "@/src/contract/index.js";
import type { ClientNotFoundError, ContractReadError, MulticallError } from "@/src/core/index.js";
import { PublicClientService, TransportError } from "@/src/core/index.js";
import { SpanNames } from "@/src/telemetry/index.js";
import type { MulticallResult } from "@/src/types/index.js";
import { decodeBytes32String } from "./utils.js";

export type TokenBalance = {
  address: Address;
  balance: bigint;
  decimals: number;
  symbol?: string;
  name?: string;
};

export type BalanceServiceShape = {
  readonly getBalance: (params: {
    chainId: number;
    address: Address;
    blockTag?: "latest" | "pending";
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  readonly getTokenBalance: (params: {
    chainId: number;
    address: Address;
    tokenAddress: Address;
  }) => Effect.Effect<bigint, ContractReadError | ClientNotFoundError>;

  readonly getTokenBalances: (params: {
    chainId: number;
    address: Address;
    tokenAddresses: Address[];
  }) => Effect.Effect<TokenBalance[], ClientNotFoundError | MulticallError>;

  readonly watchBalance: (params: {
    chainId: number;
    address: Address;
    pollingInterval?: number;
  }) => Effect.Effect<Stream.Stream<bigint, unknown>, ClientNotFoundError>;

  readonly watchTokenBalance: (params: {
    chainId: number;
    address: Address;
    tokenAddress: Address;
    pollingInterval?: number;
  }) => Effect.Effect<Stream.Stream<bigint, unknown>, ClientNotFoundError>;

  readonly hasSufficientBalance: (params: {
    chainId: number;
    address: Address;
    required: bigint;
  }) => Effect.Effect<boolean, ClientNotFoundError | TransportError>;

  readonly hasSufficientTokenBalance: (params: {
    chainId: number;
    address: Address;
    tokenAddress: Address;
    required: bigint;
  }) => Effect.Effect<boolean, ContractReadError | ClientNotFoundError>;
};

export class BalanceService extends Context.Tag("ew3/BalanceService")<
  BalanceService,
  BalanceServiceShape
>() {}

/**
 * Build multicall requests for token balances including bytes32 fallbacks
 */
function buildMulticallRequests(
  params: { chainId: number; address: Address; tokenAddresses: Address[] },
  contractReader: ContractReaderShape
) {
  // Use multicall for efficient batch queries
  const balanceCalls = params.tokenAddresses.map((tokenAddress) => ({
    abi: erc20Abi,
    address: tokenAddress,
    args: [params.address] as const,
    functionName: "balanceOf" as const,
  }));

  const decimalsCalls = params.tokenAddresses.map((tokenAddress) => ({
    abi: erc20Abi,
    address: tokenAddress,
    args: [] as const,
    functionName: "decimals" as const,
  }));

  const symbolCalls = params.tokenAddresses.map((tokenAddress) => ({
    abi: erc20Abi,
    address: tokenAddress,
    args: [] as const,
    functionName: "symbol" as const,
  }));

  const nameCalls = params.tokenAddresses.map((tokenAddress) => ({
    abi: erc20Abi,
    address: tokenAddress,
    args: [] as const,
    functionName: "name" as const,
  }));

  const symbolBytes32Calls = params.tokenAddresses.map((tokenAddress) => ({
    abi: erc20Abi_bytes32,
    address: tokenAddress,
    args: [] as const,
    functionName: "symbol" as const,
  }));

  const nameBytes32Calls = params.tokenAddresses.map((tokenAddress) => ({
    abi: erc20Abi_bytes32,
    address: tokenAddress,
    args: [] as const,
    functionName: "name" as const,
  }));

  // Combine all calls
  const allCalls = [
    ...balanceCalls,
    ...decimalsCalls,
    ...symbolCalls,
    ...nameCalls,
    ...symbolBytes32Calls,
    ...nameBytes32Calls,
  ];

  return contractReader.multicall(params.chainId, allCalls);
}

/**
 * Process multicall results and extract token balance data
 */
function processTokenBalanceResults(
  tokenAddresses: Address[],
  results: readonly MulticallResult[]
): TokenBalance[] {
  const tokenCount = tokenAddresses.length;
  const tokenBalances: TokenBalance[] = [];

  for (let i = 0; i < tokenCount; i++) {
    const balanceResult = results[i];
    const decimalsResult = results[tokenCount + i];
    const symbolResult = results[tokenCount * 2 + i];
    const nameResult = results[tokenCount * 3 + i];
    const symbolBytes32Result = results[tokenCount * 4 + i];
    const nameBytes32Result = results[tokenCount * 5 + i];

    // Prefer string results, fall back to bytes32
    const symbol = extractStringOrBytes32(symbolResult, symbolBytes32Result);
    const name = extractStringOrBytes32(nameResult, nameBytes32Result);

    tokenBalances.push({
      address: tokenAddresses[i],
      balance: balanceResult.status === "success" ? (balanceResult.result as bigint) : 0n,
      decimals: decimalsResult.status === "success" ? (decimalsResult.result as number) : 18,
      name,
      symbol,
    });
  }

  return tokenBalances;
}

/**
 * Extract string value, preferring string result over bytes32 fallback
 */
function extractStringOrBytes32(
  stringResult: MulticallResult,
  bytes32Result: MulticallResult
): string | undefined {
  if (stringResult.status === "success") {
    return stringResult.result as string;
  }
  if (bytes32Result.status === "success") {
    return decodeBytes32String(bytes32Result.result as Hex);
  }
  return undefined;
}

export const BalanceServiceLive = Layer.effect(
  BalanceService,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;
    const contractReader = yield* ContractReader;

    return BalanceService.of({
      getBalance: (params) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);

          return yield* Effect.tryPromise({
            catch: (cause) =>
              new TransportError({
                cause,
                message: `Failed to get balance (chainId=${params.chainId}, address=${params.address})`,
                url: client.transport.url ?? "unknown",
              }),
            try: () =>
              client.getBalance({
                address: params.address,
                blockTag: params.blockTag ?? "latest",
              }),
          });
        }).pipe(
          Effect.withSpan(SpanNames.BALANCE_GET, {
            attributes: {
              address: params.address,
              blockTag: params.blockTag,
              chainId: params.chainId,
            },
          })
        ),

      getTokenBalance: (params) =>
        Effect.gen(function* () {
          return (yield* contractReader.read({
            abi: erc20Abi,
            address: params.tokenAddress,
            args: [params.address],
            chainId: params.chainId,
            functionName: "balanceOf",
          })) as bigint;
        }).pipe(
          Effect.withSpan(SpanNames.BALANCE_GET_TOKEN, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              tokenAddress: params.tokenAddress,
            },
          })
        ),

      getTokenBalances: (params) =>
        Effect.gen(function* () {
          const results = yield* buildMulticallRequests(params, contractReader);
          return processTokenBalanceResults(params.tokenAddresses, results);
        }).pipe(
          Effect.withSpan(SpanNames.BALANCE_GET_TOKEN_BATCH, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              tokenCount: params.tokenAddresses.length,
            },
          })
        ),

      hasSufficientBalance: (params) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);

          const balance = yield* Effect.tryPromise({
            catch: (cause) =>
              new TransportError({
                cause,
                message: `Failed to get balance (chainId=${params.chainId}, address=${params.address})`,
                url: client.transport.url ?? "unknown",
              }),
            try: () =>
              client.getBalance({
                address: params.address,
              }),
          });

          return balance >= params.required;
        }).pipe(
          Effect.withSpan(SpanNames.BALANCE_CHECK, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              required: params.required.toString(),
            },
          })
        ),

      hasSufficientTokenBalance: (params) =>
        Effect.gen(function* () {
          const balance = (yield* contractReader.read({
            abi: erc20Abi,
            address: params.tokenAddress,
            args: [params.address],
            chainId: params.chainId,
            functionName: "balanceOf",
          })) as bigint;

          return balance >= params.required;
        }).pipe(
          Effect.withSpan(SpanNames.BALANCE_CHECK_TOKEN, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              required: params.required.toString(),
              tokenAddress: params.tokenAddress,
            },
          })
        ),

      watchBalance: (params) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);

          return Stream.async<bigint, unknown>((emit) => {
            const unwatch = client.watchBlockNumber({
              onBlockNumber: async (blockNumber) => {
                try {
                  const balance = await client.getBalance({
                    address: params.address,
                    blockNumber,
                  });
                  emit.single(balance);
                } catch (error) {
                  emit.fail(error as unknown);
                }
              },
              onError: (error) => {
                emit.fail(error as unknown);
              },
              pollingInterval: params.pollingInterval,
            });

            return Effect.sync(() => {
              unwatch();
            });
          });
        }).pipe(
          Effect.withSpan(SpanNames.BALANCE_WATCH, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              pollingInterval: params.pollingInterval,
            },
          })
        ),

      watchTokenBalance: (params) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);

          return Stream.async<bigint, unknown>((emit) => {
            const unwatch = client.watchBlockNumber({
              onBlockNumber: async (blockNumber) => {
                try {
                  const result = await client.readContract({
                    abi: erc20Abi,
                    address: params.tokenAddress,
                    args: [params.address],
                    blockNumber,
                    functionName: "balanceOf",
                  });
                  emit.single(result as bigint);
                } catch (error) {
                  emit.fail(error as unknown);
                }
              },
              onError: (error) => {
                emit.fail(error as unknown);
              },
              pollingInterval: params.pollingInterval,
            });

            return Effect.sync(() => {
              unwatch();
            });
          });
        }).pipe(
          Effect.withSpan(SpanNames.BALANCE_WATCH_TOKEN, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              pollingInterval: params.pollingInterval,
              tokenAddress: params.tokenAddress,
            },
          })
        ),
    });
  })
);
