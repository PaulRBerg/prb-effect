import type { Address, ProgramDerivedAddressBump } from "@solana/addresses";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/addresses";
import { Context, Effect, Layer } from "effect";
import { SpanNames } from "@/src/telemetry/index.js";
import { PdaDerivationError } from "./types.js";

export type PdaSeed = Uint8Array | Address;

export type ProgramDerivedAddress = readonly [Address, ProgramDerivedAddressBump];

export type PdaServiceShape = {
  /**
   * Derive a Program Derived Address from seeds and a program address.
   *
   * @returns A tuple of [address, bumpSeed]
   */
  readonly derive: (
    seeds: readonly PdaSeed[],
    programAddress: Address
  ) => Effect.Effect<ProgramDerivedAddress, PdaDerivationError>;

  /**
   * Derive a PDA and return only the address (without bump).
   */
  readonly deriveAddress: (
    seeds: readonly PdaSeed[],
    programAddress: Address
  ) => Effect.Effect<Address, PdaDerivationError>;

  /**
   * Derive a PDA and return only the bump seed.
   */
  readonly deriveBump: (
    seeds: readonly PdaSeed[],
    programAddress: Address
  ) => Effect.Effect<ProgramDerivedAddressBump, PdaDerivationError>;
};

export class PdaService extends Context.Tag("esolana/PdaService")<PdaService, PdaServiceShape>() {}

/**
 * Convert seed to Uint8Array format required by @solana/addresses.
 */
const toSeedBytes = (seed: PdaSeed): Uint8Array => {
  if (seed instanceof Uint8Array) {
    return seed;
  }
  // Address type - use address encoder
  const encoder = getAddressEncoder();
  const encoded = encoder.encode(seed);
  // Convert ReadonlyUint8Array to Uint8Array
  return new Uint8Array(encoded);
};

const makeService = (): PdaServiceShape => {
  const service: PdaServiceShape = {
    derive: (seeds, programAddress) =>
      Effect.gen(function* () {
        const seedBytes = seeds.map(toSeedBytes);
        return yield* Effect.tryPromise({
          catch: (cause) =>
            new PdaDerivationError({
              cause,
              message: `Failed to derive PDA for program ${programAddress}`,
              programAddress,
            }),
          try: () =>
            getProgramDerivedAddress({
              programAddress,
              seeds: seedBytes,
            }),
        });
      }).pipe(
        Effect.withSpan(SpanNames.PDA_DERIVE, {
          attributes: {
            programAddress,
            seedCount: seeds.length,
          },
        })
      ),

    deriveAddress: (seeds, programAddress) =>
      service.derive(seeds, programAddress).pipe(
        Effect.map(([address]) => address),
        Effect.withSpan(SpanNames.PDA_DERIVE_ADDRESS, { attributes: { programAddress } })
      ),

    deriveBump: (seeds, programAddress) =>
      service.derive(seeds, programAddress).pipe(
        Effect.map(([, bump]) => bump),
        Effect.withSpan(SpanNames.PDA_DERIVE_BUMP, { attributes: { programAddress } })
      ),
  };

  return service;
};

export const PdaServiceLive = Layer.succeed(PdaService, PdaService.of(makeService()));
