import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import type { Address } from "viem";
import { mainnet } from "viem/chains";
import { Erc721Service, Erc721TransferError } from "#src/erc721/index.js";
import { makeEffectEvmTestLayer } from "#src/testing-kit/index.js";

describe("Erc721Service (Live)", () => {
  const contract = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
  const from = "0x1234567890123456789012345678901234567890" as Address;
  const to = "0x9999999999999999999999999999999999999999" as Address;

  it.effect("maps transferFrom failures to Erc721TransferError", () => {
    const layer = makeEffectEvmTestLayer({
      walletClient: {
        writeContract: () => Promise.reject(new Error("boom")),
      },
    });

    return Effect.gen(function* () {
      const service = yield* Erc721Service;
      const exit = yield* Effect.exit(
        service.transferFrom({
          address: contract,
          chainId: mainnet.id,
          from,
          to,
          tokenId: 1n,
        })
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.findErrorOption(exit.cause);
        expect(error._tag).toBe("Some");
        if (error._tag === "Some") {
          expect(error.value).toBeInstanceOf(Erc721TransferError);
          if (error.value instanceof Erc721TransferError) {
            expect(error.value.address).toBe(contract);
            expect(error.value.from).toBe(from);
            expect(error.value.to).toBe(to);
            expect(error.value.tokenId).toBe(1n);
          }
        }
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect("maps safeTransferFrom failures to Erc721TransferError", () => {
    const layer = makeEffectEvmTestLayer({
      walletClient: {
        writeContract: () => Promise.reject(new Error("boom")),
      },
    });

    return Effect.gen(function* () {
      const service = yield* Erc721Service;
      const exit = yield* Effect.exit(
        service.safeTransferFrom({
          address: contract,
          chainId: mainnet.id,
          from,
          to,
          tokenId: 2n,
        })
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.findErrorOption(exit.cause);
        expect(error._tag).toBe("Some");
        if (error._tag === "Some") {
          expect(error.value).toBeInstanceOf(Erc721TransferError);
          if (error.value instanceof Erc721TransferError) {
            expect(error.value.tokenId).toBe(2n);
          }
        }
      }
    }).pipe(Effect.provide(layer));
  });
});
