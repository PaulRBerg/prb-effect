import { describe, expect, it } from "vitest";

const DATE_PATTERN = /Jan 15 '24/;
const PM_PATTERN = /pm/i;
const UTC_OFFSET_PATTERN = /^[+-]\d{2}:\d{2}$/;
const UTC_LABEL_PATTERN = /^UTC[+-]\d{2}:\d{2}$/;

import {
  dateMillis,
  dateSeconds,
  dateTimeMillis,
  dateTimeSeconds,
  monthYearMillis,
  nowMillis,
  nowSeconds,
  utcOffset,
  utcOffsetLabel,
} from "./date.js";

describe("date", () => {
  // Fixed timestamp: Jan 15, 2024, 14:30:45 UTC
  const FIXED_TIMESTAMP_MS = 1_705_329_045_000;
  const FIXED_TIMESTAMP_S = 1_705_329_045;

  describe("dateTimeMillis", () => {
    it("formats timestamp with date and time", () => {
      const result = dateTimeMillis(FIXED_TIMESTAMP_MS, { zone: "utc" });
      expect(result).toMatch(DATE_PATTERN);
      expect(result).toMatch(PM_PATTERN);
    });

    it("excludes time when includeTime is false", () => {
      const result = dateTimeMillis(FIXED_TIMESTAMP_MS, { includeTime: false, zone: "utc" });
      expect(result).toBe("Jan 15 '24");
    });

    it("returns invalid date for NaN", () => {
      expect(dateTimeMillis(Number.NaN)).toBe("Invalid date");
    });
  });

  describe("dateTimeSeconds", () => {
    it("converts seconds to milliseconds and formats", () => {
      const result = dateTimeSeconds(FIXED_TIMESTAMP_S, { zone: "utc" });
      expect(result).toMatch(DATE_PATTERN);
    });
  });

  describe("dateMillis", () => {
    it("formats date without time", () => {
      const result = dateMillis(FIXED_TIMESTAMP_MS, { zone: "utc" });
      expect(result).toBe("Jan 15 '24");
    });
  });

  describe("dateSeconds", () => {
    it("formats date from seconds without time", () => {
      const result = dateSeconds(FIXED_TIMESTAMP_S, { zone: "utc" });
      expect(result).toBe("Jan 15 '24");
    });
  });

  describe("monthYearMillis", () => {
    it("formats month and year only", () => {
      const result = monthYearMillis(FIXED_TIMESTAMP_MS, { zone: "utc" });
      expect(result).toBe("Jan 24");
    });
  });

  describe("utcOffset", () => {
    it("returns offset in ±HH:MM format", () => {
      const result = utcOffset();
      expect(result).toMatch(UTC_OFFSET_PATTERN);
    });
  });

  describe("utcOffsetLabel", () => {
    it("returns UTC prefix with offset", () => {
      const result = utcOffsetLabel();
      expect(result).toMatch(UTC_LABEL_PATTERN);
    });
  });

  describe("nowMillis", () => {
    it("returns current timestamp in milliseconds", () => {
      const before = Date.now();
      const result = nowMillis();
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });

  describe("nowSeconds", () => {
    it("returns current timestamp in seconds", () => {
      const before = Math.trunc(Date.now() / 1000);
      const result = nowSeconds();
      const after = Math.trunc(Date.now() / 1000);
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });

    it("returns an integer", () => {
      expect(Number.isInteger(nowSeconds())).toBe(true);
    });
  });
});
