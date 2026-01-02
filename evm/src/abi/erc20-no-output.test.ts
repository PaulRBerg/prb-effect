import { describe, expect, it } from "@effect/vitest";
import { erc20NoOutputAbi } from "@/src/abi/index.js";

describe("erc20NoOutputAbi", () => {
  it("exports a minimal ABI for approve() with no outputs", () => {
    expect(Array.isArray(erc20NoOutputAbi)).toBe(true);

    const approve = erc20NoOutputAbi.find(
      (item) => item.type === "function" && item.name === "approve"
    );

    expect(approve).toBeDefined();
    expect(approve?.type).toBe("function");
    expect(approve?.stateMutability).toBe("nonpayable");
    expect(Array.isArray(approve?.outputs)).toBe(true);
    expect(approve?.outputs?.length).toBe(0);
  });
});
