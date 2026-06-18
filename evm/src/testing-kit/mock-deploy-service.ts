import type { Layer } from "effect";
import { Effect, SubscriptionRef } from "effect";
import type { Abi, Address, ContractConstructorArgs, Hash, Hex, TransactionReceipt } from "viem";
import { MIN_TX_GAS } from "#src/constants/index.js";
import type { DeployResult, DeployServiceShape } from "#src/deploy/index.js";
import { DeployService } from "#src/deploy/index.js";
import type { TxState } from "#src/tx/index.js";
import { makeMockServiceLayer, withChainIdCheck } from "./helpers.js";

type DeployArgsField<TAbi extends Abi> =
  readonly [] extends ContractConstructorArgs<TAbi>
    ? { args?: ContractConstructorArgs<TAbi> | undefined }
    : { args: ContractConstructorArgs<TAbi> };

/**
 * Configuration for the mock DeployService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockDeployServiceConfig = {
  deploy?: <TAbi extends Abi>(
    params: {
      chainId: number;
      abi: TAbi;
      bytecode: Hex;
      value?: bigint;
      account?: Address;
      gas?: bigint;
    } & DeployArgsField<TAbi>
  ) => Effect.Effect<DeployResult>;

  deployAndTrack?: <TAbi extends Abi>(
    params: {
      chainId: number;
      abi: TAbi;
      bytecode: Hex;
      value?: bigint;
      account?: Address;
    } & DeployArgsField<TAbi>
  ) => Effect.Effect<{
    stateRef: SubscriptionRef.SubscriptionRef<TxState>;
    result: Effect.Effect<DeployResult>;
  }>;

  computeAddress?: (params: { from: Address; nonce: bigint }) => Effect.Effect<Address>;

  verifyDeployment?: (params: { chainId: number; address: Address }) => Effect.Effect<boolean>;

  verifyDeploymentStrict?: (params: {
    chainId: number;
    address: Address;
    expectedBytecode: Hex;
  }) => Effect.Effect<boolean>;
};

const DEFAULT_ADDRESS = "0x1234567890123456789012345678901234567890" as Address;
const DEFAULT_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hash;
const DEFAULT_BYTECODE =
  "0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063" as Hex;

const DEFAULT_RECEIPT: TransactionReceipt = {
  blockHash: DEFAULT_HASH,
  blockNumber: 1000n,
  contractAddress: DEFAULT_ADDRESS,
  cumulativeGasUsed: MIN_TX_GAS,
  effectiveGasPrice: 1000000000n,
  from: DEFAULT_ADDRESS,
  gasUsed: MIN_TX_GAS,
  logs: [],
  logsBloom: "0x00" as Address,
  status: "success",
  to: null,
  transactionHash: DEFAULT_HASH,
  transactionIndex: 0,
  type: "eip1559",
};

const defaultConfig: Required<MockDeployServiceConfig> = {
  computeAddress: () => Effect.succeed(DEFAULT_ADDRESS),
  deploy: () =>
    Effect.succeed({
      address: DEFAULT_ADDRESS,
      deployedBytecode: DEFAULT_BYTECODE,
      hash: DEFAULT_HASH,
      receipt: DEFAULT_RECEIPT,
    }),
  deployAndTrack: () =>
    Effect.gen(function* () {
      const stateRef = yield* SubscriptionRef.make<TxState>({ status: "idle" });
      const result = Effect.succeed({
        address: DEFAULT_ADDRESS,
        deployedBytecode: DEFAULT_BYTECODE,
        hash: DEFAULT_HASH,
        receipt: DEFAULT_RECEIPT,
      });
      return { result, stateRef };
    }),
  verifyDeployment: () => Effect.succeed(true),
  verifyDeploymentStrict: () => Effect.succeed(true),
};

/**
 * Creates a mock DeployService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainId - The chainId this mock supports (default: 1 mainnet)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockDeployServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockDeployServiceLayer({
 *   deploy: () => Effect.succeed({
 *     hash: "0x...",
 *     address: "0x...",
 *     receipt: { ... },
 *     deployedBytecode: "0x...",
 *   }),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const deployService = yield* DeployService;
 *   const result = yield* deployService.deploy({ ... });
 * }).pipe(Effect.provide(layer));
 * ```
 */
export const makeMockDeployServiceLayer = (
  config: MockDeployServiceConfig = {},
  supportedChainId = 1
): Layer.Layer<DeployService> =>
  makeMockServiceLayer(DeployService, defaultConfig, config, (merged) => ({
    // Cast to widen error type from ClientNotFoundError to full DeployService errors
    deploy: withChainIdCheck(
      supportedChainId,
      merged.deploy
    ) as unknown as DeployServiceShape["deploy"],
    // For deployAndTrack, cast the whole function to match the shape
    deployAndTrack: withChainIdCheck(
      supportedChainId,
      merged.deployAndTrack
    ) as unknown as DeployServiceShape["deployAndTrack"],
    verifyDeployment: withChainIdCheck(supportedChainId, merged.verifyDeployment),
    verifyDeploymentStrict: withChainIdCheck(supportedChainId, merged.verifyDeploymentStrict),
    computeAddress: (params) => merged.computeAddress(params),
  }));
