import { describe, expect, it } from "vitest";
import { getSafeErrorMessage } from "./errors.js";

describe("getSafeErrorMessage", () => {
  it("returns message from standard Error", () => {
    expect(getSafeErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("prefers shortMessage over message", () => {
    const error = {
      message: "message",
      shortMessage: "short message",
    };

    expect(getSafeErrorMessage(error)).toBe("short message");
  });

  it("extracts message from nested causes", () => {
    const error = {
      cause: {
        cause: {
          message: "deep message",
        },
      },
    };

    expect(getSafeErrorMessage(error)).toBe("deep message");
  });

  it("maps EIP-1193 user rejection code to a readable message", () => {
    expect(getSafeErrorMessage({ code: 4001 })).toBe("User rejected the request");
    expect(getSafeErrorMessage({ code: "4001" })).toBe("User rejected the request");
  });

  it("searches nested error arrays", () => {
    const error = {
      errors: [{ code: 4001 }, { message: "fallback" }],
    };

    expect(getSafeErrorMessage(error)).toBe("User rejected the request");
  });

  it("returns undefined when no message-like fields are present", () => {
    expect(getSafeErrorMessage({ foo: "bar" })).toBeUndefined();
  });
});
