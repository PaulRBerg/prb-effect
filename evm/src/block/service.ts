import type { Stream } from "effect";
import { Context, Effect, Layer } from "effect";
import type { Block, Hash } from "viem";
import { DEFAULT_BLOCK_WAIT_TIMEOUT } from "#src/constants/index.js";
import type { ClientNotFoundError } from "#src/core/index.js";
import { PublicClientService, TransportError } from "#src/core/index.js";
import { fromWatchCallback } from "#src/internal/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import { BlockNotFoundError, BlockTimeoutError } from "./errors.js";

export type BlockServiceShape = {
  readonly getBlock: (params: {
    chainId: number;
    blockNumber?: bigint;
    blockTag?: "latest" | "pending" | "earliest" | "safe" | "finalized";
    includeTransactions?: boolean;
  }) => Effect.Effect<Block, BlockNotFoundError | ClientNotFoundError>;

  readonly getBlockByHash: (params: {
    chainId: number;
    hash: Hash;
    includeTransactions?: boolean;
  }) => Effect.Effect<Block, BlockNotFoundError | ClientNotFoundError>;

  readonly getBlockNumber: (params: {
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  readonly watchBlocks: (params: {
    chainId: number;
    pollingInterval?: number;
    includeTransactions?: boolean;
  }) => Effect.Effect<Stream.Stream<Block, unknown>, ClientNotFoundError>;

  readonly waitForBlock: (params: {
    chainId: number;
    blockNumber: bigint;
    timeout?: number;
  }) => Effect.Effect<
    Block,
    BlockNotFoundError | BlockTimeoutError | ClientNotFoundError | TransportError
  >;

  readonly getBlocks: (params: {
    chainId: number;
    fromBlock: bigint;
    toBlock: bigint;
    includeTransactions?: boolean;
  }) => Effect.Effect<Block[], ClientNotFoundError | BlockNotFoundError>;

  readonly getBlockTimestamp: (params: {
    chainId: number;
    blockNumber?: bigint;
  }) => Effect.Effect<bigint, ClientNotFoundError | BlockNotFoundError>;
};

export class BlockService extends Context.Service<BlockService, BlockServiceShape>()(
  "ew3/BlockService"
) {}

export const BlockServiceLive = Layer.effect(
  BlockService,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;

    return BlockService.of({
      getBlock: (params) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);

          const block = yield* Effect.tryPromise({
            catch: (cause) =>
              new BlockNotFoundError({
                blockIdentifier: params.blockNumber?.toString() ?? params.blockTag ?? "latest",
                chainId: params.chainId,
                message: `Block not found: ${cause}`,
              }),
            try: () => {
              if (params.blockNumber !== undefined) {
                return client.getBlock({
                  blockNumber: params.blockNumber,
                  includeTransactions: params.includeTransactions ?? false,
                });
              }
              return client.getBlock({
                blockTag: params.blockTag ?? "latest",
                includeTransactions: params.includeTransactions ?? false,
              });
            },
          });

          return block;
        }).pipe(
          Effect.withSpan(SpanNames.BLOCK_GET, {
            attributes: {
              blockNumber: params.blockNumber?.toString(),
              blockTag: params.blockTag,
              chainId: params.chainId,
              includeTransactions: params.includeTransactions,
            },
          })
        ),

      getBlockByHash: (params) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);

          const block = yield* Effect.tryPromise({
            catch: (cause) =>
              new BlockNotFoundError({
                blockIdentifier: params.hash,
                chainId: params.chainId,
                message: `Block not found by hash: ${cause}`,
              }),
            try: () =>
              client.getBlock({
                blockHash: params.hash,
                includeTransactions: params.includeTransactions ?? false,
              }),
          });

          return block;
        }).pipe(
          Effect.withSpan(SpanNames.BLOCK_GET_BY_HASH, {
            attributes: {
              chainId: params.chainId,
              hash: params.hash,
              includeTransactions: params.includeTransactions,
            },
          })
        ),

      getBlockNumber: (params) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);

          return yield* Effect.tryPromise({
            catch: (cause) =>
              new TransportError({
                cause,
                message: `Failed to get current block number (chainId=${params.chainId})`,
                url: client.transport.url ?? "unknown",
              }),
            try: () => client.getBlockNumber(),
          });
        }).pipe(
          Effect.withSpan(SpanNames.BLOCK_GET_NUMBER, {
            attributes: {
              chainId: params.chainId,
            },
          })
        ),

      getBlocks: (params) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);
          const blockNumbers: bigint[] = [];
          for (let i = params.fromBlock; i <= params.toBlock; i++) {
            blockNumbers.push(i);
          }

          return yield* Effect.forEach(
            blockNumbers,
            (blockNumber) =>
              Effect.tryPromise({
                catch: (cause) =>
                  new BlockNotFoundError({
                    blockIdentifier: blockNumber.toString(),
                    chainId: params.chainId,
                    message: `Block ${blockNumber} not found: ${cause}`,
                  }),
                try: () =>
                  client.getBlock({
                    blockNumber,
                    includeTransactions: params.includeTransactions ?? false,
                  }),
              }),
            { concurrency: 10 }
          );
        }).pipe(
          Effect.withSpan(SpanNames.BLOCK_GET_RANGE, {
            attributes: {
              chainId: params.chainId,
              fromBlock: params.fromBlock.toString(),
              includeTransactions: params.includeTransactions,
              toBlock: params.toBlock.toString(),
            },
          })
        ),

      getBlockTimestamp: (params) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);

          const block = yield* Effect.tryPromise({
            catch: (cause) =>
              new BlockNotFoundError({
                blockIdentifier: params.blockNumber?.toString() ?? "latest",
                chainId: params.chainId,
                message: `Block not found: ${cause}`,
              }),
            try: () => {
              if (params.blockNumber !== undefined) {
                return client.getBlock({
                  blockNumber: params.blockNumber,
                });
              }
              return client.getBlock({
                blockTag: "latest",
              });
            },
          });

          return block.timestamp;
        }).pipe(
          Effect.withSpan(SpanNames.BLOCK_GET_TIMESTAMP, {
            attributes: {
              blockNumber: params.blockNumber?.toString(),
              chainId: params.chainId,
            },
          })
        ),

      waitForBlock: (params) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);
          const timeout = params.timeout ?? DEFAULT_BLOCK_WAIT_TIMEOUT;

          const poll = Effect.gen(function* () {
            while (true) {
              const currentBlock = yield* Effect.tryPromise({
                catch: (cause) =>
                  new TransportError({
                    cause,
                    message: `Failed to get current block number (chainId=${params.chainId})`,
                    url: client.transport.url ?? "unknown",
                  }),
                try: () => client.getBlockNumber(),
              });

              if (currentBlock >= params.blockNumber) {
                return yield* Effect.tryPromise({
                  catch: (cause) =>
                    new BlockNotFoundError({
                      blockIdentifier: params.blockNumber.toString(),
                      chainId: params.chainId,
                      message: `Failed to fetch block ${params.blockNumber}: ${String(cause)}`,
                    }),
                  try: () =>
                    client.getBlock({
                      blockNumber: params.blockNumber,
                    }),
                });
              }

              yield* Effect.sleep(1000);
            }
          });

          return yield* poll.pipe(
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () =>
                Effect.fail(
                  new BlockTimeoutError({
                    blockNumber: params.blockNumber,
                    chainId: params.chainId,
                    message: `Timeout waiting for block ${params.blockNumber}`,
                    timeout,
                  })
                ),
            })
          );
        }).pipe(
          Effect.withSpan(SpanNames.BLOCK_WAIT, {
            attributes: {
              blockNumber: params.blockNumber.toString(),
              chainId: params.chainId,
              timeout: params.timeout,
            },
          })
        ),

      watchBlocks: (params) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);

          return fromWatchCallback<Block, unknown>({
            mapError: (error) => error as unknown,
            watch: (cb) =>
              client.watchBlocks({
                includeTransactions: params.includeTransactions ?? false,
                onBlock: cb.onData,
                onError: cb.onError,
                pollingInterval: params.pollingInterval,
              }),
          });
        }).pipe(
          Effect.withSpan(SpanNames.BLOCK_WATCH, {
            attributes: {
              chainId: params.chainId,
              includeTransactions: params.includeTransactions,
              pollingInterval: params.pollingInterval,
            },
          })
        ),
    });
  })
);
