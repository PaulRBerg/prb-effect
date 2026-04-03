import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { base, mainnet } from "viem/chains";
import { GasService } from "#src/gas/index.js";
import { makeMockGasServiceLayer } from "#src/testing-kit/index.js";

describe("testing-kit: makeMockGasServiceLayer", () => {
  describe("estimateL1Fee", () => {
    it.effect("returns 0n by default", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const fee = yield* service.estimateL1Fee({
          chainId: mainnet.id,
          to: "0x1234567890123456789012345678901234567890",
        });

        expect(fee).toBe(0n);
      }).pipe(Effect.provide(makeMockGasServiceLayer()))
    );

    it.effect("uses the configured implementation", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const fee = yield* service.estimateL1Fee({
          chainId: base.id,
          to: "0x1234567890123456789012345678901234567890",
        });

        expect(fee).toBe(42n);
      }).pipe(
        Effect.provide(
          makeMockGasServiceLayer(
            {
              estimateL1Fee: () => Effect.succeed(42n),
            },
            base.id
          )
        )
      )
    );
  });

  describe("hasL1DataFee", () => {
    it.effect("returns false by default", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const result = yield* service.hasL1DataFee({
          chainId: mainnet.id,
        });

        expect(result).toBe(false);
      }).pipe(Effect.provide(makeMockGasServiceLayer()))
    );

    it.effect("uses the configured implementation", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const result = yield* service.hasL1DataFee({
          chainId: base.id,
        });

        expect(result).toBe(true);
      }).pipe(
        Effect.provide(
          makeMockGasServiceLayer(
            {
              hasL1DataFee: () => Effect.succeed(true),
            },
            base.id
          )
        )
      )
    );
  });
});
