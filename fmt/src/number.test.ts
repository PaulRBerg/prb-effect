import { BigDecimal } from "effect";
import { describe, expect, it } from "vitest";

import { bigDecimal, decimal, integer, numeric } from "./number.js";

describe("number", () => {
  describe("integer", () => {
    it("formats integers without decimals", () => {
      expect(integer(1234)).toBe("1,234");
    });

    it("truncates decimal values", () => {
      expect(integer(1234.567)).toBe("1,235");
    });

    it("handles negative numbers", () => {
      expect(integer(-1234)).toBe("-1,234");
    });

    it("handles zero", () => {
      expect(integer(0)).toBe("0");
    });
  });

  describe("decimal", () => {
    it("formats decimal numbers with default options", () => {
      expect(decimal(1234.56)).toBe("1,234.56");
    });

    it("handles whole numbers", () => {
      expect(decimal(1234)).toBe("1,234");
    });

    it("handles negative decimals", () => {
      expect(decimal(-1234.56)).toBe("-1,234.56");
    });
  });

  describe("numeric", () => {
    it("limits fraction digits to specified maximum", () => {
      expect(numeric(1.123_456_789, { maxFractionDigits: 2 })).toBe("1.12");
    });

    it("pads with minimum fraction digits", () => {
      expect(numeric(1.5, { minFractionDigits: 3 })).toBe("1.500");
    });

    it("uses default of 6 max fraction digits", () => {
      expect(numeric(1.123_456_789)).toBe("1.123457");
    });
  });

  describe("bigDecimal", () => {
    it("formats BigDecimal values", () => {
      const value = BigDecimal.fromNumber(1234.56);
      expect(bigDecimal(value)).toBe("1,234.56");
    });

    it("respects fraction digit options", () => {
      const value = BigDecimal.fromNumber(1.123_456_789);
      expect(bigDecimal(value, { maxFractionDigits: 2 })).toBe("1.12");
    });

    it("handles zero", () => {
      const value = BigDecimal.fromNumber(0);
      expect(bigDecimal(value)).toBe("0");
    });
  });
});
