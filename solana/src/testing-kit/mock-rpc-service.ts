import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import type { Layer } from "effect";
import { Effect } from "effect";
import { ConnectionNotFoundError } from "#src/core/errors/index.js";
import { RpcService } from "#src/rpc/index.js";
import type { Cluster } from "#src/types/index.js";
import { TEST_CLUSTER, TEST_SIGNATURE } from "./_fixtures/addresses.js";
import { makeMockServiceLayer } from "./helpers.js";

/**
 * Configuration for the mock RpcService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockRpcServiceConfig = {
  readonly getRpc?: () => Effect.Effect<Connection>;
  readonly getRpcSubscriptions?: () => Effect.Effect<Connection, ConnectionNotFoundError>;
  readonly getCluster?: () => Effect.Effect<Cluster>;
  readonly getRpcUrl?: () => Effect.Effect<string>;
};

const wrapResponse = <T>(value: T) => ({ context: { slot: 0 }, value });

const defaultTokenAmount = {
  amount: "1000000000",
  decimals: 9,
  uiAmount: 1.0,
  uiAmountString: "1.0",
};

/**
 * Create a mock web3.js Connection for testing.
 */
export const makeMockRpc = (overrides: Partial<Connection> = {}): Connection =>
  ({
    getAccountInfo: () => Promise.resolve(null),
    getBalance: () => Promise.resolve(1_000_000_000),
    getBlockHeight: () => Promise.resolve(1000),
    getLatestBlockhash: () =>
      Promise.resolve({
        blockhash: "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC",
        lastValidBlockHeight: 1000,
      }),
    getSignatureStatuses: () =>
      Promise.resolve(
        wrapResponse([
          {
            confirmationStatus: "confirmed",
            confirmations: 10,
            err: null,
            slot: 1000,
          },
        ])
      ),
    getTokenAccountBalance: () => Promise.resolve(wrapResponse(defaultTokenAmount)),
    sendRawTransaction: () => Promise.resolve(TEST_SIGNATURE),
    simulateTransaction: () =>
      Promise.resolve(
        wrapResponse({
          err: null,
          logs: [] as string[],
          returnData: null,
        })
      ),
    ...overrides,
  }) as Connection;

export const makeMockAccountInfo = (
  data: Buffer,
  owner: PublicKey,
  overrides: Partial<AccountInfo<Buffer>> = {}
): AccountInfo<Buffer> => ({
  data,
  executable: false,
  lamports: 1,
  owner,
  rentEpoch: 0,
  ...overrides,
});

const defaultConfig: Required<MockRpcServiceConfig> = {
  getCluster: () => Effect.succeed(TEST_CLUSTER),
  getRpc: () => Effect.succeed(makeMockRpc()),
  getRpcSubscriptions: () =>
    Effect.fail(
      new ConnectionNotFoundError({
        cluster: TEST_CLUSTER,
        message: "WebSocket not configured in mock",
      })
    ),
  getRpcUrl: () => Effect.succeed("https://api.devnet.solana.com"),
};

/**
 * Creates a mock RpcService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 */
export const makeMockRpcServiceLayer = (
  config: MockRpcServiceConfig = {}
): Layer.Layer<RpcService> =>
  makeMockServiceLayer(RpcService, defaultConfig, config, (merged) => merged);
