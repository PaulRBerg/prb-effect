import { describe, expect, it } from "@effect/vitest";
import { BigDecimal, Option } from "effect";
import { formatGas, fromWei, multiplyBigintByDecimal, toWei } from "./numbers.js";

describe("internal/numbers", () => {
  describe("toWei / fromWei round-trip", () => {
    const roundTripCases: readonly bigint[] = [
      0n,
      1n,
      1_500_000_000_000_000_000n, // 1.5e18
      1_000_000_000_000_000_000n, // 1e18
      999_999_999_999_999_999_999_999n,
    ];

    for (const wei of roundTripCases) {
      it(`toWei(fromWei(${wei})) === ${wei}`, () => {
        const result = toWei(fromWei(wei));
        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toBe(wei);
        }
      });
    }

    it("toWei(1.5) returns the full wei amount, not the stripped mantissa", () => {
      // Regression: BigDecimal.normalize used to shrink 1.5e18 down to 15n.
      const result = toWei(BigDecimal.make(15n, 1)); // 1.5
      expect(result).toStrictEqual(Option.some(1_500_000_000_000_000_000n));
    });

    it("rejects inputs with sub-wei precision (>18 decimals) as None", () => {
      // 1e-19 carries 19 decimals; scale(.,18) would truncate it silently.
      const subWei = BigDecimal.make(1n, 19);
      expect(toWei(subWei)).toStrictEqual(Option.none());
    });

    it("accepts an input with exactly 18 decimals of precision", () => {
      const exact = BigDecimal.make(123_456_789_012_345_678n, 18); // 0.123...678
      expect(toWei(exact)).toStrictEqual(Option.some(123_456_789_012_345_678n));
    });
  });

  describe("multiplyBigintByDecimal basis-point rounding", () => {
    it("rounds 1.005 to 10050 basis points (not 10049)", () => {
      // 1.005 * 10_000 === 10049.999999999998 in IEEE-754; floor truncated it.
      const result = multiplyBigintByDecimal(1_000_000n, 1.005);
      expect(result).toStrictEqual(Option.some(1_005_000n));
    });

    it("scales by a whole multiplier exactly", () => {
      expect(multiplyBigintByDecimal(1_000n, 2)).toStrictEqual(Option.some(2_000n));
    });

    it("returns None for negative or non-finite multipliers", () => {
      expect(multiplyBigintByDecimal(1_000n, -1)).toStrictEqual(Option.none());
      expect(multiplyBigintByDecimal(1_000n, Number.NaN)).toStrictEqual(Option.none());
    });
  });

  describe("formatGas precision", () => {
    it("formats values within the safe-integer range via Intl", () => {
      expect(formatGas(21_000n)).toBe("21,000");
    });

    it("formats exactly Number.MAX_SAFE_INTEGER via Intl", () => {
      const safe = BigInt(Number.MAX_SAFE_INTEGER); // 9_007_199_254_740_991
      expect(formatGas(safe)).toBe("9,007,199,254,740,991");
    });

    it("falls back to the exact bigint string above 2^53", () => {
      // Number(this) would round to 9_007_199_254_740_992, losing the last digit.
      const huge = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
      expect(formatGas(huge)).toBe("9007199254740992");
    });

    it("preserves precision for very large gas values", () => {
      const huge = 123_456_789_012_345_678_901_234_567_890n;
      expect(formatGas(huge)).toBe("123456789012345678901234567890");
    });
  });
});
