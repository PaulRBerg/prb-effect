import { describe, expect, it } from "@effect/vitest";
import { defaultPolicy } from "@/src/tx/index.js";

describe("TxPolicy", () => {
  it("defaultPolicy.pollingInterval equals 4000", () => {
    expect(defaultPolicy.pollingInterval).toBe(4000);
  });

  it("defaultPolicy.receiptTimeout equals 120000", () => {
    expect(defaultPolicy.receiptTimeout).toBe(120_000);
  });

  it("defaultPolicy.replacementStrategy equals none", () => {
    expect(defaultPolicy.replacementStrategy).toBe("none");
  });

  it("defaultPolicy is a valid TxPolicy with all expected keys", () => {
    expect(defaultPolicy).toHaveProperty("pollingInterval");
    expect(defaultPolicy).toHaveProperty("receiptTimeout");
    expect(defaultPolicy).toHaveProperty("replacementStrategy");

    // Validate types
    expect(typeof defaultPolicy.pollingInterval).toBe("number");
    expect(typeof defaultPolicy.receiptTimeout).toBe("number");
    expect(typeof defaultPolicy.replacementStrategy).toBe("string");
  });
});
