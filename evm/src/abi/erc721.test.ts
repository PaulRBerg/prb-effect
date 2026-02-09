import { describe, expect, it } from "@effect/vitest";
import { ERC721_INTERFACE_ID, erc721Abi } from "#src/abi/index.js";

describe("ERC-721 ABI Exports", () => {
  it("exports erc721Abi from viem", () => {
    expect(erc721Abi).toBeDefined();
    expect(Array.isArray(erc721Abi)).toBe(true);
    expect(erc721Abi.length).toBeGreaterThan(0);
  });

  it("erc721Abi contains standard ERC-721 functions", () => {
    const functionNames = erc721Abi
      .filter((item) => item.type === "function")
      .map((item) => item.name);

    expect(functionNames).toContain("balanceOf");
    expect(functionNames).toContain("ownerOf");
    expect(functionNames).toContain("safeTransferFrom");
    expect(functionNames).toContain("transferFrom");
    expect(functionNames).toContain("approve");
    expect(functionNames).toContain("setApprovalForAll");
    expect(functionNames).toContain("getApproved");
    expect(functionNames).toContain("isApprovedForAll");
  });

  it("erc721Abi contains standard ERC-721 events", () => {
    const eventNames = erc721Abi.filter((item) => item.type === "event").map((item) => item.name);

    expect(eventNames).toContain("Transfer");
    expect(eventNames).toContain("Approval");
    expect(eventNames).toContain("ApprovalForAll");
  });

  it("exports correct ERC-721 interface ID", () => {
    expect(ERC721_INTERFACE_ID).toBe("0x80ac58cd");
  });
});
