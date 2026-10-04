import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { GasLimitOverflowError } from "./errors.js";

describe("GasLimitOverflowError", () => {
  it("round-trips bigint fields as decimal strings", () => {
    const error = new GasLimitOverflowError({
      blockGasLimit: 30_000_000n,
      estimatedGas: 29_000_000n,
      message: "Gas threshold exceeded",
      threshold: 28_500_000n,
    });
    const encoded = Schema.encodeSync(GasLimitOverflowError)(error);
    expect(encoded).toMatchObject({
      blockGasLimit: "30000000",
      estimatedGas: "29000000",
      threshold: "28500000",
    });
    expect(Schema.decodeSync(GasLimitOverflowError)(encoded)).toEqual(error);
  });
});
