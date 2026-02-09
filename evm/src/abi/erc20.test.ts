import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { erc20Abi, erc20Abi_bytes32 } from "#src/abi/index.js";
import { ApprovalCheckError, ApprovalError } from "#src/core/index.js";

describe("ERC-20 ABI Exports", () => {
  it("exports erc20Abi from viem", () => {
    expect(erc20Abi).toBeDefined();
    expect(Array.isArray(erc20Abi)).toBe(true);
    expect(erc20Abi.length).toBeGreaterThan(0);
  });

  it("erc20Abi contains standard ERC-20 functions", () => {
    const functionNames = erc20Abi
      .filter((item) => item.type === "function")
      .map((item) => item.name);

    expect(functionNames).toContain("balanceOf");
    expect(functionNames).toContain("transfer");
    expect(functionNames).toContain("approve");
    expect(functionNames).toContain("allowance");
    expect(functionNames).toContain("transferFrom");
  });

  it("erc20Abi contains standard ERC-20 events", () => {
    const eventNames = erc20Abi.filter((item) => item.type === "event").map((item) => item.name);

    expect(eventNames).toContain("Transfer");
    expect(eventNames).toContain("Approval");
  });

  it("exports erc20Abi_bytes32 from viem", () => {
    expect(erc20Abi_bytes32).toBeDefined();
    expect(Array.isArray(erc20Abi_bytes32)).toBe(true);
  });
});

describe("ApprovalCheckError", () => {
  it("has correct _tag", () => {
    const error = new ApprovalCheckError({
      message: "Allowance check failed",
      owner: "0x1234",
      spender: "0x5678",
      tokenAddress: "0xabcd",
    });
    expect(error._tag).toBe("ApprovalCheckError");
  });

  it("stores all fields correctly", () => {
    const cause = new Error("RPC error");
    const error = new ApprovalCheckError({
      cause,
      message: "Allowance check failed",
      owner: "0x1234",
      spender: "0x5678",
      tokenAddress: "0xabcd",
    });
    expect(error.message).toBe("Allowance check failed");
    expect(error.owner).toBe("0x1234");
    expect(error.spender).toBe("0x5678");
    expect(error.tokenAddress).toBe("0xabcd");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new ApprovalCheckError({
          message: "test",
          owner: "0x1234",
          spender: "0x5678",
          tokenAddress: "0xabcd",
        })
      ).pipe(Effect.catchTag("ApprovalCheckError", (e) => Effect.succeed(e)));
      expect(caught.owner).toBe("0x1234");
      expect(caught.spender).toBe("0x5678");
      expect(caught.tokenAddress).toBe("0xabcd");
    })
  );
});

describe("ApprovalError", () => {
  it("has correct _tag", () => {
    const error = new ApprovalError({
      message: "Approval failed",
      spender: "0x5678",
      tokenAddress: "0xabcd",
    });
    expect(error._tag).toBe("ApprovalError");
  });

  it("stores all fields correctly", () => {
    const cause = new Error("Transaction reverted");
    const error = new ApprovalError({
      cause,
      message: "Approval failed",
      spender: "0x5678",
      tokenAddress: "0xabcd",
    });
    expect(error.message).toBe("Approval failed");
    expect(error.spender).toBe("0x5678");
    expect(error.tokenAddress).toBe("0xabcd");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new ApprovalError({
          message: "test",
          spender: "0x5678",
          tokenAddress: "0xabcd",
        })
      ).pipe(Effect.catchTag("ApprovalError", (e) => Effect.succeed(e)));
      expect(caught.spender).toBe("0x5678");
      expect(caught.tokenAddress).toBe("0xabcd");
    })
  );
});
