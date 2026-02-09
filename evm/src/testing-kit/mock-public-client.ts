import type { Effect } from "effect";
import { Layer } from "effect";
import { constVoid as noop } from "effect/Function";
import type {
  Address,
  Block,
  Hash,
  Hex,
  TransactionReceipt,
  WatchContractEventParameters,
} from "viem";
import { MIN_TX_GAS } from "#src/constants/index.js";
import type { PublicClientServiceShape } from "#src/core/index.js";
import { PublicClientService } from "#src/core/index.js";
import { makeChainIdGetter } from "./helpers.js";

/**
 * Configuration for the mock PublicClient
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockPublicClientConfig = {
  // Contract methods
  readContract?: (params: unknown) => Promise<unknown>;
  multicall?: (
    params: unknown
  ) => Promise<Array<{ status: "success"; result: unknown } | { status: "failure"; error: Error }>>;
  estimateContractGas?: (params: unknown) => Promise<bigint>;
  simulateContract?: (params: unknown) => Promise<{ request: unknown; result: unknown }>;

  // Balance methods
  getBalance?: (params: {
    address: Address;
    blockTag?: "latest" | "pending";
    blockNumber?: bigint;
  }) => Promise<bigint>;

  // Transaction methods
  waitForTransactionReceipt?: (params: { hash: Hash }) => Promise<TransactionReceipt>;
  getTransactionConfirmations?: (
    params: { hash: Hash } | { transactionReceipt: TransactionReceipt }
  ) => Promise<bigint>;
  getTransactionCount?: (params: {
    address: Address;
    blockTag: "latest" | "pending";
  }) => Promise<number>;

  // Event methods
  watchContractEvent?: (params: WatchContractEventParameters) => () => void;
  getLogs?: (params: unknown) => Promise<unknown[]>;

  // Block methods
  getBlockNumber?: () => Promise<bigint>;
  getBlock?: (params: unknown) => Promise<Block>;
  watchBlockNumber?: (params: unknown) => () => void;
  watchBlocks?: (params: unknown) => () => void;
  watchEvent?: (params: unknown) => () => void;
  watchPendingTransactions?: (params: unknown) => () => void;

  // Gas methods
  getGasPrice?: () => Promise<bigint>;
  estimateMaxPriorityFeePerGas?: () => Promise<bigint>;
  estimateGas?: (params: unknown) => Promise<bigint>;

  // Bytecode methods
  getBytecode?: (params: { address: Address }) => Promise<Hex | null>;

  // ENS methods
  getEnsAddress?: (params: unknown) => Promise<Address | null>;
  getEnsName?: (params: unknown) => Promise<string | null>;
  getEnsAvatar?: (params: unknown) => Promise<string | null>;
  getEnsText?: (params: unknown) => Promise<string | null>;
  getEnsResolver?: (params: unknown) => Promise<Address | null>;
};

const DEFAULT_ADDRESS = "0x1234567890123456789012345678901234567890" as Address;
const DEFAULT_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hash;
const DEFAULT_RESOLVER = "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41" as Address;
const DEFAULT_BYTECODE = "0x608060405234801561001057600080fd5b50" as Hex;

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
 * Creates a mock PublicClientService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainId - The chainId this mock supports (default: 1 mainnet)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockPublicClientLayer();
 *
 * // Override specific methods
 * const layer = makeMockPublicClientLayer({
 *   readContract: async () => 1000n,
 *   getEnsAddress: async () => "0x...",
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const reader = yield* ContractReader;
 *   const result = yield* reader.read({ ... });
 * }).pipe(
 *   Effect.provide(Layer.provide(ContractReaderLive, layer))
 * );
 * ```
 */
export const makeMockPublicClientLayer = (
  config: MockPublicClientConfig = {},
  supportedChainId = 1
): Layer.Layer<PublicClientService> => {
  const defaultMulticall: NonNullable<MockPublicClientConfig["multicall"]> = (params: unknown) => {
    const calls = (params as { contracts?: unknown[] }).contracts ?? [];
    return Promise.resolve(calls.map(() => ({ result: 100n, status: "success" as const })));
  };

  const defaultWaitForTransactionReceipt: NonNullable<
    MockPublicClientConfig["waitForTransactionReceipt"]
  > = async (params: { hash: Hash }): Promise<TransactionReceipt> => ({
    blockHash: DEFAULT_HASH,
    blockNumber: 1000n,
    contractAddress: null,
    cumulativeGasUsed: MIN_TX_GAS,
    effectiveGasPrice: 1000000000n,
    from: DEFAULT_ADDRESS,
    gasUsed: MIN_TX_GAS,
    logs: [],
    logsBloom: "0x00" as Address,
    status: "success",
    to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
    transactionHash: params.hash,
    transactionIndex: 0,
    type: "eip1559",
  });

  const {
    estimateContractGas = async () => MIN_TX_GAS,
    estimateGas = async () => MIN_TX_GAS,
    estimateMaxPriorityFeePerGas = async () => 1500000000n,
    getBalance = async () => 1000000000000000000n,
    getBlock = async () => DEFAULT_BLOCK,
    getBlockNumber = async () => 1000n,
    getBytecode = async () => DEFAULT_BYTECODE,
    getEnsAddress = async () => DEFAULT_ADDRESS,
    getEnsAvatar = async () => "https://example.com/avatar.png",
    getEnsName = async () => "mock.eth",
    getEnsResolver = async () => DEFAULT_RESOLVER,
    getEnsText = async () => "mock-text-record",
    getGasPrice = async () => 45000000000n,
    getLogs = async () => [],
    getTransactionConfirmations = async () => 3n,
    getTransactionCount = async () => 0,
    multicall = defaultMulticall,
    readContract = async () => 100n,
    simulateContract = async () => ({ request: {}, result: true }),
    waitForTransactionReceipt = defaultWaitForTransactionReceipt,
    watchBlockNumber = () => noop,
    watchBlocks = () => noop,
    watchContractEvent = () => noop,
    watchEvent = () => noop,
    watchPendingTransactions = () => noop,
  } = config;

  // Create mock PublicClient
  const mockPublicClient = {
    chain: { id: supportedChainId },
    estimateContractGas,
    estimateGas,
    estimateMaxPriorityFeePerGas,
    getBalance,
    getBlock,
    getBlockNumber,
    getBytecode,
    getEnsAddress,
    getEnsAvatar,
    getEnsName,
    getEnsResolver,
    getEnsText,
    getGasPrice,
    getLogs,
    getTransactionConfirmations,
    getTransactionCount,
    multicall,
    readContract,
    simulateContract,
    transport: { type: "http", url: "http://localhost" },
    waitForTransactionReceipt,
    watchBlockNumber,
    watchBlocks,
    watchContractEvent,
    watchEvent,
    watchPendingTransactions,
  } as unknown as ReturnType<PublicClientServiceShape["get"]> extends Effect.Effect<
    infer A,
    infer _E,
    infer _R
  >
    ? A
    : never;

  return Layer.succeed(
    PublicClientService,
    PublicClientService.of({
      get: makeChainIdGetter(supportedChainId, () => mockPublicClient),
    })
  );
};
