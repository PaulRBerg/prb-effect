import { describe, expect, it } from "@effect/vitest";

const { extractErrorData, hasTaggedErrorShape } = await import("./extract.js");

const TEST_VALUE = "1000000000000000000";

describe("errors/extract", () => {
  it("hasTaggedErrorShape() accepts a minimal tagged error shape", () => {
    expect(hasTaggedErrorShape({ _tag: "Foo", message: "bar" })).toBe(true);
  });

  it("hasTaggedErrorShape() rejects missing fields and non-objects", () => {
    expect(hasTaggedErrorShape(null)).toBe(false);
    expect(hasTaggedErrorShape("nope")).toBe(false);
    expect(hasTaggedErrorShape({ _tag: "Foo" })).toBe(false);
    expect(hasTaggedErrorShape({ message: "bar" })).toBe(false);
    expect(hasTaggedErrorShape({ _tag: 123, message: "bar" })).toBe(false);
    expect(hasTaggedErrorShape({ _tag: "Foo", message: 123 })).toBe(false);
  });

  it("extractErrorData() preserves value for direct tagged errors", () => {
    const tagged = {
      _tag: "Reverted",
      address: "0xabc",
      calldata: "0xdeadbeef",
      cause: { nested: true },
      functionName: "transfer",
      message: "execution reverted",
      sender: "0xdef",
      value: TEST_VALUE,
    };

    expect(extractErrorData(tagged)).toEqual({
      details: {
        address: "0xabc",
        calldata: "0xdeadbeef",
        cause: { nested: true },
        functionName: "transfer",
        sender: "0xdef",
        tag: "Reverted",
        value: TEST_VALUE,
      },
      message: "execution reverted",
    });
  });

  it("extractErrorData() returns Error.message for Error instances", () => {
    expect(extractErrorData(new Error("boom"))).toBe("boom");
  });

  it("extractErrorData() preserves value for serialized tagged errors", () => {
    const serialized = new Error(
      JSON.stringify({
        _tag: "ContractWriteError",
        address: "0xabc",
        calldata: "0xdeadbeef",
        cause: { nested: true },
        functionName: "transfer",
        message: "execution reverted",
        sender: "0xdef",
        value: TEST_VALUE,
      })
    );

    expect(extractErrorData(serialized)).toEqual({
      details: {
        address: "0xabc",
        calldata: "0xdeadbeef",
        cause: { nested: true },
        functionName: "transfer",
        sender: "0xdef",
        tag: "ContractWriteError",
        value: TEST_VALUE,
      },
      message: "execution reverted",
    });
  });

  it("extractErrorData() falls back for unknown values", () => {
    expect(extractErrorData(123, "fallback")).toBe("fallback");
    expect(extractErrorData(undefined)).toBe("Operation failed");
  });
});
