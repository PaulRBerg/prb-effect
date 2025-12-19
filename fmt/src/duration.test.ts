import { describe, expect, it } from "vitest";

import {
  compoundDurationSeconds,
  durationMillis,
  durationSeconds,
  elapsedMillis,
} from "./duration.js";

describe("duration", () => {
  describe("durationSeconds", () => {
    it("formats seconds", () => {
      expect(durationSeconds(45)).toBe("45 seconds");
    });

    it("formats minutes", () => {
      expect(durationSeconds(120)).toBe("2 minutes");
    });

    it("formats hours", () => {
      expect(durationSeconds(7200)).toBe("2 hours");
    });

    it("formats days", () => {
      expect(durationSeconds(172_800)).toBe("2 days");
    });

    it("formats years", () => {
      expect(durationSeconds(86_400 * 400)).toBe("1 year");
    });

    it("handles zero", () => {
      expect(durationSeconds(0)).toBe("0 seconds");
    });
  });

  describe("durationMillis", () => {
    it("converts milliseconds to seconds", () => {
      expect(durationMillis(45_000)).toBe("45 seconds");
    });

    it("formats minutes from milliseconds", () => {
      expect(durationMillis(120_000)).toBe("2 minutes");
    });
  });

  describe("compoundDurationSeconds", () => {
    it("formats days only", () => {
      expect(compoundDurationSeconds(86_400 * 15)).toBe("15 days");
    });

    it("formats months only", () => {
      expect(compoundDurationSeconds(86_400 * 60)).toBe("2 months");
    });

    it("formats months and remaining days", () => {
      expect(compoundDurationSeconds(86_400 * 45)).toBe("1 month 15 days");
    });
  });

  describe("elapsedMillis", () => {
    it("formats hours when less than a day", () => {
      const now = Date.now();
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;
      expect(elapsedMillis(twoHoursAgo, now)).toBe("2 hours");
    });

    it("formats days and hours", () => {
      const now = Date.now();
      const oneDayTwoHoursAgo = now - (24 + 2) * 60 * 60 * 1000;
      expect(elapsedMillis(oneDayTwoHoursAgo, now)).toBe("1 day 2 hours");
    });

    it("handles zero elapsed time", () => {
      const now = Date.now();
      expect(elapsedMillis(now, now)).toBe("0 hours");
    });
  });
});
