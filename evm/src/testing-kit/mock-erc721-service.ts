import type { Layer } from "effect";
import { Effect } from "effect";
import type { Address, Hash, Hex } from "viem";
import type { Erc721ServiceShape, NftMetadata } from "#src/erc721/index.js";
import { Erc721Service } from "#src/erc721/index.js";
import { makeMockServiceLayer, withChainIdCheck, withWalletChainIdCheck } from "./helpers.js";

/**
 * Configuration for the mock Erc721Service
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockErc721ServiceConfig = {
  // Read methods
  ownerOf?: (params: {
    address: Address;
    chainId: number;
    tokenId: bigint;
  }) => Effect.Effect<Address>;
  balanceOf?: (params: {
    address: Address;
    chainId: number;
    owner: Address;
  }) => Effect.Effect<bigint>;
  getApproved?: (params: {
    address: Address;
    chainId: number;
    tokenId: bigint;
  }) => Effect.Effect<Address>;
  isApprovedForAll?: (params: {
    address: Address;
    chainId: number;
    operator: Address;
    owner: Address;
  }) => Effect.Effect<boolean>;
  tokenURI?: (params: {
    address: Address;
    chainId: number;
    tokenId: bigint;
  }) => Effect.Effect<string>;
  fetchMetadata?: (params: {
    address: Address;
    chainId: number;
    gateways?: { arweave?: string; ipfs?: string };
    tokenId: bigint;
  }) => Effect.Effect<NftMetadata>;
  name?: (params: { address: Address; chainId: number }) => Effect.Effect<string>;
  symbol?: (params: { address: Address; chainId: number }) => Effect.Effect<string>;
  totalSupply?: (params: { address: Address; chainId: number }) => Effect.Effect<bigint>;

  // Write methods
  approve?: (params: {
    account?: Address;
    address: Address;
    chainId: number;
    to: Address;
    tokenId: bigint;
  }) => Effect.Effect<Hash>;
  setApprovalForAll?: (params: {
    account?: Address;
    address: Address;
    approved: boolean;
    chainId: number;
    operator: Address;
  }) => Effect.Effect<Hash>;
  transferFrom?: (params: {
    account?: Address;
    address: Address;
    chainId: number;
    from: Address;
    to: Address;
    tokenId: bigint;
  }) => Effect.Effect<Hash>;
  safeTransferFrom?: (params: {
    account?: Address;
    address: Address;
    chainId: number;
    data?: Hex;
    from: Address;
    to: Address;
    tokenId: bigint;
  }) => Effect.Effect<Hash>;
};

const DEFAULT_ADDRESS = "0x1234567890123456789012345678901234567890" as Address;
const DEFAULT_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hash;

const defaultConfig: Required<MockErc721ServiceConfig> = {
  // Write defaults
  approve: () => Effect.succeed(DEFAULT_HASH),
  balanceOf: () => Effect.succeed(5n),
  fetchMetadata: () =>
    Effect.succeed({
      attributes: [],
      description: "A mock NFT for testing purposes",
      image: "ipfs://QmMockHash/image.png",
      name: "Mock NFT",
    }),
  getApproved: () => Effect.succeed(DEFAULT_ADDRESS),
  isApprovedForAll: () => Effect.succeed(false),
  name: () => Effect.succeed("MockNFT"),
  // Read defaults
  ownerOf: () => Effect.succeed(DEFAULT_ADDRESS),
  safeTransferFrom: () => Effect.succeed(DEFAULT_HASH),
  setApprovalForAll: () => Effect.succeed(DEFAULT_HASH),
  symbol: () => Effect.succeed("MNFT"),
  tokenURI: () => Effect.succeed("ipfs://QmMockHash/metadata.json"),
  totalSupply: () => Effect.succeed(10000n),
  transferFrom: () => Effect.succeed(DEFAULT_HASH),
};

/**
 * Creates a mock Erc721Service layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainId - The chainId this mock supports (default: 1 mainnet)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockErc721ServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockErc721ServiceLayer({
 *   ownerOf: () => Effect.succeed("0x..." as Address),
 *   balanceOf: () => Effect.succeed(10n),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const erc721 = yield* Erc721Service;
 *   const owner = yield* erc721.ownerOf({ ... });
 * }).pipe(Effect.provide(layer));
 * ```
 */
export const makeMockErc721ServiceLayer = (
  config: MockErc721ServiceConfig = {},
  supportedChainId = 1
): Layer.Layer<Erc721Service> =>
  makeMockServiceLayer(Erc721Service, defaultConfig, config, (merged) => ({
    // Write methods use WalletNotConnectedError - cast to widen to expected error types
    approve: withWalletChainIdCheck(
      supportedChainId,
      merged.approve
    ) as Erc721ServiceShape["approve"],
    // Read methods use ClientNotFoundError - cast where needed to widen error types
    balanceOf: withChainIdCheck(supportedChainId, merged.balanceOf),
    fetchMetadata: withChainIdCheck(supportedChainId, merged.fetchMetadata),
    getApproved: withChainIdCheck(supportedChainId, merged.getApproved),
    isApprovedForAll: withChainIdCheck(supportedChainId, merged.isApprovedForAll),
    name: withChainIdCheck(supportedChainId, merged.name),
    ownerOf: withChainIdCheck(supportedChainId, merged.ownerOf) as Erc721ServiceShape["ownerOf"],
    safeTransferFrom: withWalletChainIdCheck(
      supportedChainId,
      merged.safeTransferFrom
    ) as Erc721ServiceShape["safeTransferFrom"],
    setApprovalForAll: withWalletChainIdCheck(
      supportedChainId,
      merged.setApprovalForAll
    ) as Erc721ServiceShape["setApprovalForAll"],
    symbol: withChainIdCheck(supportedChainId, merged.symbol),
    tokenURI: withChainIdCheck(supportedChainId, merged.tokenURI) as Erc721ServiceShape["tokenURI"],
    totalSupply: withChainIdCheck(supportedChainId, merged.totalSupply),
    transferFrom: withWalletChainIdCheck(
      supportedChainId,
      merged.transferFrom
    ) as Erc721ServiceShape["transferFrom"],
  }));
