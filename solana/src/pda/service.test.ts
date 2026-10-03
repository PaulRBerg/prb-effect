import { describe, expect, it } from "@effect/vitest";
import { PublicKey } from "@solana/web3.js";
import { Effect } from "effect";
import { expectTaggedFailure, TEST_ADDRESS } from "#src/testing-kit/index.js";
import { PdaService, PdaServiceLive } from "./index.js";

describe("PdaService", () => {
  it.effect("derives the same PDA for an address seed and its bytes", () =>
    Effect.gen(function* () {
      const service = yield* PdaService;
      const fromAddress = yield* service.derive([TEST_ADDRESS], TEST_ADDRESS);
      const fromBytes = yield* service.derive(
        [new PublicKey(TEST_ADDRESS).toBytes()],
        TEST_ADDRESS
      );
      expect(fromAddress).toEqual(fromBytes);
    }).pipe(Effect.provide(PdaServiceLive))
  );

  it.effect("maps malformed address seeds to PdaDerivationError", () =>
    Effect.gen(function* () {
      const service = yield* PdaService;
      const exit = yield* Effect.exit(service.derive(["bad"], TEST_ADDRESS));
      expectTaggedFailure(exit, "PdaDerivationError");
    }).pipe(Effect.provide(PdaServiceLive))
  );
});
