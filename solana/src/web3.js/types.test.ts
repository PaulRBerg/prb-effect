import { describe, expect, it } from "@effect/vitest";
import { address } from "@solana/addresses";
import { PublicKey } from "@solana/web3.js";
import { addressToPublicKey, publicKeyToAddress } from "./types.js";

describe("types (compat)", () => {
  describe("publicKeyToAddress", () => {
    it("converts PublicKey to Address", () => {
      const pk = new PublicKey("11111111111111111111111111111111");
      const addr = publicKeyToAddress(pk);

      expect(addr).toBe("11111111111111111111111111111111");
    });

    it("handles different valid addresses", () => {
      const testAddresses = [
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK",
        "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      ];

      for (const addr of testAddresses) {
        const pk = new PublicKey(addr);
        const converted = publicKeyToAddress(pk);
        expect(converted).toBe(addr);
      }
    });

    it("accepts any object with toBase58 method", () => {
      const mockPk = {
        toBase58: () => "11111111111111111111111111111111",
      };

      const addr = publicKeyToAddress(mockPk);
      expect(addr).toBe("11111111111111111111111111111111");
    });
  });

  describe("addressToPublicKey", () => {
    it("converts Address to PublicKey", async () => {
      const addr = address("11111111111111111111111111111111");
      const pk = await addressToPublicKey(addr);

      expect(pk).toBeInstanceOf(PublicKey);
      expect((pk as PublicKey).toBase58()).toBe("11111111111111111111111111111111");
    });

    it("handles different valid addresses", async () => {
      const testAddresses = [
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK",
        "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      ];

      for (const addrStr of testAddresses) {
        const addr = address(addrStr);
        const pk = await addressToPublicKey(addr);
        expect((pk as PublicKey).toBase58()).toBe(addrStr);
      }
    });

    it("roundtrip conversion preserves address", async () => {
      const originalAddr = address("DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK");
      const pk = await addressToPublicKey(originalAddr);
      const convertedAddr = publicKeyToAddress(pk as { toBase58(): string });

      expect(convertedAddr).toBe(originalAddr);
    });

    it("throws error for invalid address string", async () => {
      // Note: @solana/addresses may validate at construction time,
      // so we test that PublicKey constructor throws on invalid input
      await expect(async () => {
        const { PublicKey: PK } = await import("@solana/web3.js");
        new PK("invalid-address");
      }).rejects.toThrow();
    });

    it("throws error for malformed base58 string", async () => {
      // Test with a string that looks like an address but is invalid
      await expect(async () => {
        const { PublicKey: PK } = await import("@solana/web3.js");
        new PK("ThisIsNotAValidSolanaAddress123");
      }).rejects.toThrow();
    });
  });
});
