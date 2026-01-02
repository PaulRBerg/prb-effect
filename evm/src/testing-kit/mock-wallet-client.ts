import type { Effect } from "effect";
import { Layer } from "effect";
import type { Address, Hash, Hex, TypedData } from "viem";
import type { WalletClientServiceShape } from "@/src/core/index.js";
import { WalletClientService } from "@/src/core/index.js";
import { makeWalletChainIdGetter } from "./helpers.js";

/**
 * Configuration for the mock WalletClient
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockWalletClientConfig = {
  // Contract methods
  writeContract?: (params: unknown) => Promise<Hash>;
  sendTransaction?: (params: unknown) => Promise<Hash>;

  // Signing methods
  signMessage?: (params: { message: string | Hex }) => Promise<Hex>;
  signTypedData?: (params: { typedData: TypedData }) => Promise<Hex>;
  signTransaction?: (params: unknown) => Promise<Hex>;

  // Account config
  accountAddress?: Address;
};

const DEFAULT_ADDRESS = "0x1234567890123456789012345678901234567890" as Address;
const DEFAULT_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hash;
const DEFAULT_SIGNATURE =
  "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001b" as Hex;

/**
 * Creates a mock WalletClientService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainId - The chainId this mock supports (default: 1 mainnet)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockWalletClientLayer();
 *
 * // Override specific methods
 * const layer = makeMockWalletClientLayer({
 *   writeContract: async () => "0xtxhash...",
 *   accountAddress: "0xmyaddress...",
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const writer = yield* ContractWriter;
 *   const hash = yield* writer.write({ ... });
 * }).pipe(
 *   Effect.provide(Layer.provide(ContractWriterLive, layer))
 * );
 * ```
 */
export const makeMockWalletClientLayer = (
  config: MockWalletClientConfig = {},
  supportedChainId = 1
): Layer.Layer<WalletClientService> => {
  // Contract defaults
  const writeContract = config.writeContract ?? (async () => DEFAULT_HASH);
  const sendTransaction = config.sendTransaction ?? (async () => DEFAULT_HASH);

  // Signing defaults
  const signMessage = config.signMessage ?? (async () => DEFAULT_SIGNATURE);
  const signTypedData = config.signTypedData ?? (async () => DEFAULT_SIGNATURE);
  const signTransaction = config.signTransaction ?? (async () => DEFAULT_SIGNATURE);

  // Account config
  const accountAddress = config.accountAddress ?? DEFAULT_ADDRESS;

  // Create mock WalletClient
  const mockWalletClient = {
    account: {
      address: accountAddress,
      type: "json-rpc",
    },
    chain: { id: supportedChainId },
    sendTransaction,
    signMessage,
    signTransaction,
    signTypedData,
    writeContract,
  } as unknown as ReturnType<WalletClientServiceShape["get"]> extends Effect.Effect<
    infer A,
    infer _E,
    infer _R
  >
    ? A
    : never;

  return Layer.succeed(
    WalletClientService,
    WalletClientService.of({
      get: makeWalletChainIdGetter(supportedChainId, () => mockWalletClient),
    })
  );
};
