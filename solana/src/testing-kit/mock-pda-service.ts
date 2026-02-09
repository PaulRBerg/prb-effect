import type { Address, ProgramDerivedAddressBump } from "@solana/addresses";
import type { Layer } from "effect";
import { Effect } from "effect";
import type { PdaSeed, ProgramDerivedAddress } from "#src/pda/index.js";
import { PdaService } from "#src/pda/index.js";
import { TEST_ADDRESS } from "./_fixtures/addresses.js";
import { makeMockServiceLayer } from "./helpers.js";

/**
 * Configuration for the mock PdaService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockPdaServiceConfig = {
  derive?: (
    seeds: readonly PdaSeed[],
    programAddress: Address
  ) => Effect.Effect<ProgramDerivedAddress>;
  deriveAddress?: (seeds: readonly PdaSeed[], programAddress: Address) => Effect.Effect<Address>;
  deriveBump?: (
    seeds: readonly PdaSeed[],
    programAddress: Address
  ) => Effect.Effect<ProgramDerivedAddressBump>;
};

const defaultConfig: Required<MockPdaServiceConfig> = {
  derive: () => Effect.succeed([TEST_ADDRESS, 255 as ProgramDerivedAddressBump] as const),
  deriveAddress: () => Effect.succeed(TEST_ADDRESS),
  deriveBump: () => Effect.succeed(255 as ProgramDerivedAddressBump),
};

/**
 * Creates a mock PdaService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockPdaServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockPdaServiceLayer({
 *   derive: () => Effect.succeed([customAddress, 250 as ProgramDerivedAddressBump]),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const pdaService = yield* PdaService;
 *   const [pda, bump] = yield* pdaService.derive([seed1, seed2], programId);
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockPdaServiceLayer = (
  config: MockPdaServiceConfig = {}
): Layer.Layer<PdaService> =>
  makeMockServiceLayer(PdaService, defaultConfig, config, (merged) => merged);
