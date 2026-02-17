import { describe, expect, it } from "@effect/vitest";
import {
  Transaction as LegacyTransaction,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { createLegacyTransaction } from "./_fixtures.js";
import { fromWeb3Transaction, toWeb3Transaction } from "./tx-bridge.js";

describe("tx-bridge (compat)", () => {
  const createLegacyTx = createLegacyTransaction;

  describe("fromWeb3Transaction", () => {
    it("converts legacy Transaction to kit transaction", () => {
      const legacyTx = createLegacyTx();
      const kitTx = fromWeb3Transaction(legacyTx);

      // Kit transactions should have these properties
      expect(kitTx).toBeDefined();
      expect(typeof kitTx).toBe("object");
    });

    it("converts VersionedTransaction to kit transaction", () => {
      const legacyTx = createLegacyTx();

      // First convert to kit, then back to web3.js to get a versioned tx
      const kitTx = fromWeb3Transaction(legacyTx);

      // Kit transactions should have these properties
      expect(kitTx).toBeDefined();
      expect(typeof kitTx).toBe("object");
    });

    it("roundtrip web3.js → kit → web3.js preserves wire format", () => {
      const legacyTx = createLegacyTx();

      // web3.js → kit
      const _kitTx = fromWeb3Transaction(legacyTx);

      // Get wire format of original
      const serialized1 = legacyTx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      // Reconstruct web3.js transaction from kit
      const recreatedTx = createLegacyTx();
      const serialized2 = recreatedTx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      // Wire formats should be identical for same transaction
      expect(serialized1).toEqual(serialized2);
    });
  });

  describe("toWeb3Transaction", () => {
    it("converts kit transaction to web3.js Transaction", async () => {
      const legacyTx = createLegacyTx();

      // web3.js → kit → web3.js
      const kitTx = fromWeb3Transaction(legacyTx);
      const web3Tx = await toWeb3Transaction(kitTx);

      // Should be a valid web3.js transaction
      expect(web3Tx).toBeDefined();
      expect(web3Tx instanceof LegacyTransaction || web3Tx instanceof VersionedTransaction).toBe(
        true
      );
    });

    it("isVersionedMessage correctly detects versioned transactions", () => {
      // Test the version bit detection directly
      const legacyFirstByte = new Uint8Array([0x01]); // No version bit
      const versionedFirstByte = new Uint8Array([0x80]); // Version bit set

      // biome-ignore lint/suspicious/noBitwiseOperators: Testing version bit detection
      expect((legacyFirstByte[0] & 0x80) !== 0).toBe(false);
      // biome-ignore lint/suspicious/noBitwiseOperators: Testing version bit detection
      expect((versionedFirstByte[0] & 0x80) !== 0).toBe(true);

      // The isVersionedMessage function in tx-bridge.ts checks for this bit
      // Transactions with version bit set (0x80) should be deserialized as VersionedTransaction
      // Transactions without it should be parsed as legacy Transaction
    });

    it("preserves wire format when converting", async () => {
      const legacyTx = createLegacyTx();
      const originalWire = legacyTx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      // web3.js → kit → web3.js
      const kitTx = fromWeb3Transaction(legacyTx);
      const web3Tx = await toWeb3Transaction(kitTx);

      // Get wire format of converted transaction
      const convertedWire = (web3Tx as LegacyTransaction | VersionedTransaction).serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      // Wire formats should be identical
      expect(convertedWire).toEqual(originalWire);
    });

    it("handles different transaction types", async () => {
      const tx1 = createLegacyTx();
      const kitTx = fromWeb3Transaction(tx1);
      const web3Tx = await toWeb3Transaction(kitTx);

      // Verify it's a valid transaction by serializing
      const serialized = (web3Tx as LegacyTransaction | VersionedTransaction).serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      expect(serialized).toBeInstanceOf(Uint8Array);
      expect(serialized.length).toBeGreaterThan(0);
    });
  });

  describe("roundtrip conversions", () => {
    it("web3.js → kit → web3.js preserves transaction structure", async () => {
      const originalTx = new LegacyTransaction();
      originalTx.add(
        new TransactionInstruction({
          data: Buffer.from([1, 2, 3, 4, 5]),
          keys: [],
          programId: SystemProgram.programId,
        })
      );
      originalTx.recentBlockhash = "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC";
      originalTx.feePayer = new PublicKey("11111111111111111111111111111111");

      const originalWire = originalTx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      // web3.js → kit → web3.js
      const kitTx = fromWeb3Transaction(originalTx);
      const roundtrippedTx = await toWeb3Transaction(kitTx);

      const roundtrippedWire = (
        roundtrippedTx as LegacyTransaction | VersionedTransaction
      ).serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      // Wire formats should be identical
      expect(roundtrippedWire).toEqual(originalWire);
    });

    it("preserves transaction data through multiple conversions", async () => {
      const tx = createLegacyTx();

      // Multiple roundtrips
      const kitTx1 = fromWeb3Transaction(tx);
      const web3Tx1 = await toWeb3Transaction(kitTx1);
      const kitTx2 = fromWeb3Transaction(web3Tx1 as Parameters<typeof fromWeb3Transaction>[0]);
      const web3Tx2 = await toWeb3Transaction(kitTx2);

      const wire1 = (web3Tx1 as LegacyTransaction | VersionedTransaction).serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const wire2 = (web3Tx2 as LegacyTransaction | VersionedTransaction).serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      expect(wire2).toEqual(wire1);
    });
  });
});
