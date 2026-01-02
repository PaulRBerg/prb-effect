import type { Layer } from "effect";
import { Effect, Stream } from "effect";
import type { Block, Hash } from "viem";
import type { BlockNotFoundError, BlockTimeoutError } from "@/src/block/index.js";
import { BlockService } from "@/src/block/index.js";
import type { ClientNotFoundError, TransportError } from "@/src/core/index.js";
import { makeMockServiceLayer, withChainIdCheck } from "./helpers.js";

const DEFAULT_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hash;

const DEFAULT_BLOCK: Block = {
  baseFeePerGas: 30000000000n,
  blobGasUsed: 0n,
  difficulty: 0n,
  excessBlobGas: 0n,
  extraData: "0x",
  gasLimit: 30000000n,
  gasUsed: 12000000n,
  hash: DEFAULT_HASH,
  logsBloom: "0x00",
  miner: "0x0000000000000000000000000000000000000000",
  mixHash: DEFAULT_HASH,
  nonce: "0x0000000000000000",
  number: 1000n,
  parentHash: DEFAULT_HASH,
  receiptsRoot: DEFAULT_HASH,
  sealFields: [],
  sha3Uncles: DEFAULT_HASH,
  size: 1024n,
  stateRoot: DEFAULT_HASH,
  timestamp: 1700000000n,
  totalDifficulty: 0n,
  transactions: [],
  transactionsRoot: DEFAULT_HASH,
  uncles: [],
};

/**
 * Configuration for the mock BlockService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockBlockServiceConfig = {
  getBlock?: (params: {
    chainId: number;
    blockNumber?: bigint;
    blockTag?: "latest" | "pending" | "earliest" | "safe" | "finalized";
    includeTransactions?: boolean;
  }) => Effect.Effect<Block, BlockNotFoundError | ClientNotFoundError>;

  getBlockByHash?: (params: {
    chainId: number;
    hash: Hash;
    includeTransactions?: boolean;
  }) => Effect.Effect<Block, BlockNotFoundError | ClientNotFoundError>;

  getBlockNumber?: (params: {
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  watchBlocks?: (params: {
    chainId: number;
    pollingInterval?: number;
    includeTransactions?: boolean;
  }) => Effect.Effect<Stream.Stream<Block, unknown>, ClientNotFoundError>;

  waitForBlock?: (params: {
    chainId: number;
    blockNumber: bigint;
    timeout?: number;
  }) => Effect.Effect<
    Block,
    BlockNotFoundError | BlockTimeoutError | ClientNotFoundError | TransportError
  >;

  getBlocks?: (params: {
    chainId: number;
    fromBlock: bigint;
    toBlock: bigint;
    includeTransactions?: boolean;
  }) => Effect.Effect<Block[], ClientNotFoundError | BlockNotFoundError>;

  getBlockTimestamp?: (params: {
    chainId: number;
    blockNumber?: bigint;
  }) => Effect.Effect<bigint, ClientNotFoundError | BlockNotFoundError>;
};

const defaultConfig: Required<MockBlockServiceConfig> = {
  getBlock: () => Effect.succeed(DEFAULT_BLOCK),
  getBlockByHash: () => Effect.succeed(DEFAULT_BLOCK),
  getBlockNumber: () => Effect.succeed(1000n),
  getBlocks: (params: { fromBlock: bigint; toBlock: bigint }) => {
    const count = Number(params.toBlock - params.fromBlock) + 1;
    return Effect.succeed(
      Array.from({ length: count }, (_, i) => ({
        ...DEFAULT_BLOCK,
        number: params.fromBlock + BigInt(i),
      }))
    );
  },
  getBlockTimestamp: () => Effect.succeed(1700000000n),
  waitForBlock: () => Effect.succeed(DEFAULT_BLOCK),
  watchBlocks: () => Effect.succeed(Stream.make(DEFAULT_BLOCK)),
};

/**
 * Creates a mock BlockService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainId - The chainId this mock supports (default: 1 mainnet)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockBlockServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockBlockServiceLayer({
 *   getBlockNumber: () => Effect.succeed(2000n),
 *   getBlock: () => Effect.succeed({ ...customBlock }),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const blockService = yield* BlockService;
 *   const blockNumber = yield* blockService.getBlockNumber({ chainId: mainnet.id });
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockBlockServiceLayer = (
  config: MockBlockServiceConfig = {},
  supportedChainId = 1
): Layer.Layer<BlockService> =>
  makeMockServiceLayer(BlockService, defaultConfig, config, (merged) => ({
    getBlock: withChainIdCheck(supportedChainId, merged.getBlock),
    getBlockByHash: withChainIdCheck(supportedChainId, merged.getBlockByHash),
    getBlockNumber: withChainIdCheck(supportedChainId, merged.getBlockNumber),
    getBlocks: withChainIdCheck(supportedChainId, merged.getBlocks),
    getBlockTimestamp: withChainIdCheck(supportedChainId, merged.getBlockTimestamp),
    waitForBlock: withChainIdCheck(supportedChainId, merged.waitForBlock),
    watchBlocks: withChainIdCheck(supportedChainId, merged.watchBlocks),
  }));
