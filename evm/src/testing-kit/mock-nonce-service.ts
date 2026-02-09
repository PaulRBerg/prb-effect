import type { Layer } from "effect";
import { Effect } from "effect";
import type { Address } from "viem";
import type { ClientNotFoundError, TransportError } from "#src/core/index.js";
import { NonceService } from "#src/nonce/index.js";
import { makeMockServiceLayer, withChainIdCheck } from "./helpers.js";

/**
 * Configuration for the mock NonceService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockNonceServiceConfig = {
  getNext?: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  reserve?: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  release?: (params: {
    address: Address;
    chainId: number;
    nonce: bigint;
  }) => Effect.Effect<void, never>;

  confirm?: (params: {
    address: Address;
    chainId: number;
    nonce: bigint;
  }) => Effect.Effect<void, never>;

  getPendingCount?: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  getConfirmedCount?: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  getGaps?: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint[], ClientNotFoundError>;

  sync?: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;
};

const defaultConfig: Required<MockNonceServiceConfig> = {
  confirm: () => Effect.succeed(undefined),
  getConfirmedCount: () => Effect.succeed(0n),
  getGaps: () => Effect.succeed([]),
  getNext: () => Effect.succeed(0n),
  getPendingCount: () => Effect.succeed(0n),
  release: () => Effect.succeed(undefined),
  reserve: () => Effect.succeed(0n),
  sync: () => Effect.succeed(0n),
};

/**
 * Creates a mock NonceService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 * @param supportedChainId - The chainId this mock supports (default: 1 mainnet)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockNonceServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockNonceServiceLayer({
 *   getNext: () => Effect.succeed(5n),
 *   reserve: () => Effect.succeed(5n),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const nonceService = yield* NonceService;
 *   const nonce = yield* nonceService.getNext({
 *     chainId: mainnet.id,
 *     address: "0x...",
 *   });
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockNonceServiceLayer = (
  config: MockNonceServiceConfig = {},
  supportedChainId = 1
): Layer.Layer<NonceService> =>
  makeMockServiceLayer(NonceService, defaultConfig, config, (merged) => ({
    // Methods that never fail - they succeed silently for unsupported chains
    confirm: (params) =>
      params.chainId === supportedChainId ? merged.confirm(params) : Effect.succeed(undefined),

    // Methods that can fail with ClientNotFoundError
    getConfirmedCount: withChainIdCheck(supportedChainId, merged.getConfirmedCount),
    getGaps: withChainIdCheck(supportedChainId, merged.getGaps),
    getNext: withChainIdCheck(supportedChainId, merged.getNext),
    getPendingCount: withChainIdCheck(supportedChainId, merged.getPendingCount),
    release: (params) =>
      params.chainId === supportedChainId ? merged.release(params) : Effect.succeed(undefined),
    reserve: withChainIdCheck(supportedChainId, merged.reserve),
    sync: withChainIdCheck(supportedChainId, merged.sync),
  }));
