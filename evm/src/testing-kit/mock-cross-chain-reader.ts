import { Effect, Layer } from "effect";
import type {
  ChainMulticallBatch,
  CrossChainCall,
  CrossChainReader,
  CrossChainReaderShape,
  ReadSameParams,
} from "#src/contract/index.js";
import { CrossChainReader as CrossChainReaderTag } from "#src/contract/index.js";
import type { ClientNotFoundError, ContractReadError, MulticallError } from "#src/core/index.js";
import { ClientNotFoundError as ClientNotFoundErrorClass } from "#src/core/index.js";
import type {
  Abi,
  ContractFunctionName,
  ContractFunctionReturnType,
  MulticallResult,
} from "#src/types/index.js";

/**
 * Configuration for the mock CrossChainReader
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockCrossChainReaderConfig = {
  readAll?: <const TCalls extends readonly CrossChainCall[]>(
    calls: TCalls
  ) => Effect.Effect<Map<number, unknown[]>, ContractReadError | ClientNotFoundError>;

  readSame?: <TAbi extends Abi, TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">>(
    params: ReadSameParams<TAbi, TFunctionName>
  ) => Effect.Effect<
    Map<number, ContractFunctionReturnType<TAbi, "pure" | "view", TFunctionName>>,
    ContractReadError | ClientNotFoundError
  >;

  multicallAll?: <const TBatches extends readonly ChainMulticallBatch[]>(
    batches: TBatches
  ) => Effect.Effect<
    Map<number, readonly MulticallResult<unknown>[]>,
    MulticallError | ClientNotFoundError
  >;
};

/**
 * Creates a mock CrossChainReader layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainIds - The chainIds this mock supports (default: [1])
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockCrossChainReaderLayer();
 *
 * // Override specific methods
 * const layer = makeMockCrossChainReaderLayer({
 *   readSame: (params) => {
 *     const resultMap = new Map();
 *     for (const chainId of params.chainIds) {
 *       resultMap.set(chainId, 1000n);
 *     }
 *     return Effect.succeed(resultMap);
 *   },
 * }, [1, 137, 42161]);
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const crossChainReader = yield* CrossChainReader;
 *   const results = yield* crossChainReader.readSame({
 *     chainIds: [1, 137],
 *     address: tokenAddr,
 *     abi: ERC20_ABI,
 *     functionName: "balanceOf",
 *     args: [userAddr],
 *   });
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockCrossChainReaderLayer = (
  config: MockCrossChainReaderConfig = {},
  supportedChainIds: readonly number[] = [1]
): Layer.Layer<CrossChainReader> => {
  const readAll =
    config.readAll ??
    (<const TCalls extends readonly CrossChainCall[]>(calls: TCalls) => {
      const resultMap = new Map<number, unknown[]>();
      const chainIds = new Set(calls.map((c) => c.chainId));

      for (const chainId of chainIds) {
        if (!supportedChainIds.includes(chainId)) {
          return Effect.fail(
            new ClientNotFoundErrorClass({
              chainId,
              message: `No client configured for chain ID ${chainId}`,
            })
          );
        }
      }

      for (const chainId of chainIds) {
        const chainCalls = calls.filter((c) => c.chainId === chainId);
        resultMap.set(
          chainId,
          chainCalls.map(() => 0n)
        );
      }

      return Effect.succeed(resultMap);
    });

  const readSame =
    config.readSame ??
    (<TAbi extends Abi, TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">>(
      params: ReadSameParams<TAbi, TFunctionName>
    ) => {
      const resultMap = new Map<
        number,
        ContractFunctionReturnType<TAbi, "pure" | "view", TFunctionName>
      >();

      for (const chainId of params.chainIds) {
        if (!supportedChainIds.includes(chainId)) {
          return Effect.fail(
            new ClientNotFoundErrorClass({
              chainId,
              message: `No client configured for chain ID ${chainId}`,
            })
          );
        }
      }

      for (const chainId of params.chainIds) {
        resultMap.set(
          chainId,
          0n as ContractFunctionReturnType<TAbi, "pure" | "view", TFunctionName>
        );
      }

      return Effect.succeed(resultMap);
    });

  const multicallAll =
    config.multicallAll ??
    (<const TBatches extends readonly ChainMulticallBatch[]>(batches: TBatches) => {
      const resultMap = new Map<number, readonly MulticallResult<unknown>[]>();

      for (const batch of batches) {
        if (!supportedChainIds.includes(batch.chainId)) {
          return Effect.fail(
            new ClientNotFoundErrorClass({
              chainId: batch.chainId,
              message: `No client configured for chain ID ${batch.chainId}`,
            })
          );
        }
      }

      for (const batch of batches) {
        resultMap.set(
          batch.chainId,
          batch.calls.map(() => ({
            result: 0n,
            status: "success" as const,
          }))
        );
      }

      return Effect.succeed(resultMap);
    });

  const mockCrossChainReader: CrossChainReaderShape = {
    multicallAll,
    readAll,
    readSame,
  };

  return Layer.succeed(CrossChainReaderTag, CrossChainReaderTag.of(mockCrossChainReader));
};
