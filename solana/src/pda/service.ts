import { PublicKey } from "@solana/web3.js";
import { Context, Effect, Layer } from "effect";
import { SpanNames } from "#src/telemetry/index.js";
import type { Address } from "#src/types/index.js";
import { PdaDerivationError } from "./types.js";

export type ProgramDerivedAddressBump = number;

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
 * Convert seed to bytes accepted by web3.js PDA derivation.
 */
const toSeedBytes = (seed: PdaSeed): Uint8Array => {
  if (seed instanceof Uint8Array) {
    return seed;
  }
  return new PublicKey(seed).toBytes();
};

const makeService = (): PdaServiceShape => {
  const service: PdaServiceShape = {
    derive: (seeds, programAddress) =>
      Effect.gen(function* () {
        const seedBytes = seeds.map(toSeedBytes);
        return yield* Effect.try({
          catch: (cause) =>
            new PdaDerivationError({
              cause,
              message: `Failed to derive PDA for program ${programAddress}`,
              programAddress,
            }),
          try: () => {
            const [address, bump] = PublicKey.findProgramAddressSync(
              seedBytes,
              new PublicKey(programAddress)
            );
            return [address.toBase58() as Address, bump] as const;
          },
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
