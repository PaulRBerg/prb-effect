import { describe, expect, it } from "@effect/vitest";
import {
  InsufficientFundsError,
  ReceiptTimeoutError,
  UserRejectedError,
} from "#src/core/errors/tx.js";
import { toUserFacingTxError } from "./user-facing.js";

describe("toUserFacingTxError", () => {
  it("maps known tagged errors to stable categories", () => {
    const mapped = toUserFacingTxError(
      new InsufficientFundsError({
        message: "Insufficient balance",
      })
    );

    expect(mapped.category).toBe("insufficient-funds");
    expect(mapped.retryable).toBe(false);
    expect(mapped.message).toBe("Insufficient balance");
  });

  it("marks network timeout errors as retryable", () => {
    const mapped = toUserFacingTxError(
      new ReceiptTimeoutError({
        hash: "0xabc",
        message: "Timed out while waiting for receipt",
        timeout: 30_000,
      })
    );

    expect(mapped.category).toBe("network");
    expect(mapped.retryable).toBe(true);
  });

  it("maps user rejection to cancelled", () => {
    const mapped = toUserFacingTxError(new UserRejectedError({ message: "Rejected by user" }));

    expect(mapped.category).toBe("cancelled");
    expect(mapped.retryable).toBe(false);
  });

  it("preserves unknown error messages for telemetry", () => {
    const source = new Error("unexpected failure");
    const mapped = toUserFacingTxError(source);

    expect(mapped.category).toBe("unknown");
    expect(mapped.message).toBe("unexpected failure");
    expect(mapped.raw).toBe(source);
  });
});
