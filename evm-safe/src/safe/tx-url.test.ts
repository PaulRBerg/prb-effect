import type { Address, Hash } from "viem";
import { describe, expect, it } from "vitest";
import { getSafeMultisigTxUrl } from "./tx-url.js";

const SAFE_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678" as Address;
const SAFE_TX_HASH = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Hash;

describe("getSafeMultisigTxUrl", () => {
  it("builds a Safe tx URL using the default Safe origin", () => {
    const url = new URL(
      getSafeMultisigTxUrl({
        safeAddress: SAFE_ADDRESS,
        safeTxHash: SAFE_TX_HASH,
      })
    );

    expect(url.origin).toBe("https://app.safe.global");
    expect(url.pathname).toBe("/transactions/tx");
    expect(url.searchParams.get("id")).toBe(`multisig_${SAFE_ADDRESS}_${SAFE_TX_HASH}`);
    expect(url.searchParams.get("safe")).toBeNull();
  });

  it("supports custom Safe origins and safe query values", () => {
    const url = new URL(
      getSafeMultisigTxUrl({
        safe: `sep:${SAFE_ADDRESS}`,
        safeAddress: SAFE_ADDRESS,
        safeAppOrigin: "https://safe.optimism.io",
        safeTxHash: SAFE_TX_HASH,
      })
    );

    expect(url.origin).toBe("https://safe.optimism.io");
    expect(url.pathname).toBe("/transactions/tx");
    expect(url.searchParams.get("id")).toBe(`multisig_${SAFE_ADDRESS}_${SAFE_TX_HASH}`);
    expect(url.searchParams.get("safe")).toBe(`sep:${SAFE_ADDRESS}`);
  });
});
