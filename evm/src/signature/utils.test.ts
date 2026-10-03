import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Hex } from "viem";
import { SignatureService, SignatureServiceLive } from "#src/signature/index.js";
import { isValidSignature } from "./utils.js";

describe("signature format validation", () => {
  it("accepts exactly 65 hexadecimal bytes", () => {
    expect(isValidSignature(`0x${"aB".repeat(64)}1b`)).toBe(true);
    expect(isValidSignature("0x1234")).toBe(false);
  });

  it.effect("rejects malformed r, s, and v through the typed error channel", () =>
    Effect.gen(function* () {
      const service = yield* SignatureService;
      for (const signature of [
        `0xzz${"00".repeat(63)}1b`,
        `0x${"00".repeat(32)}zz${"00".repeat(31)}1b`,
        `0x${"00".repeat(64)}zz`,
      ] as Hex[]) {
        expect(isValidSignature(signature)).toBe(false);
        const error = yield* service.splitSignature(signature).pipe(Effect.flip);
        expect(error._tag).toBe("InvalidSignatureError");
      }
    }).pipe(Effect.provide(SignatureServiceLive))
  );
});
