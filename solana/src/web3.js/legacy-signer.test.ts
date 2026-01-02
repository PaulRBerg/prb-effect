import { describe, expect, it } from "@effect/vitest";
import { PublicKey } from "@solana/web3.js";
import { Effect } from "effect";
import { SignerService } from "@/src/signer/index.js";
import { expectTaggedFailure } from "@/src/testing-kit/index.js";
import { createLegacyTransaction } from "./_fixtures.js";
import { makeSignerServiceFromLegacyAdapter } from "./legacy-signer.js";
import { fromWeb3Transaction } from "./transaction-bridge.js";
import type { LegacyWalletAdapter } from "./types.js";

describe("legacy-signer (compat)", () => {
  const createMockAdapter = (overrides: Partial<LegacyWalletAdapter> = {}): LegacyWalletAdapter => {
    const defaultPk = new PublicKey("DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK");

    return {
      connected: true,
      publicKey: defaultPk,
      signAllTransactions: async <T>(txs: T[]) => txs,
      signTransaction: async <T>(tx: T) => tx,
      ...overrides,
    };
  };

  const createLegacyTx = createLegacyTransaction;

  describe("getAddress", () => {
    it.effect("returns correct address when connected", () => {
      const mockPk = new PublicKey("DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK");
      const adapter = createMockAdapter({ publicKey: mockPk });
      const layer = makeSignerServiceFromLegacyAdapter(() => adapter);

      return Effect.gen(function* () {
        const signer = yield* SignerService;
        const addr = yield* signer.getAddress();

        expect(addr).toBe("DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK");
      }).pipe(Effect.provide(layer));
    });

    it.effect("fails with WalletNotConnectedError when disconnected", () => {
      const adapter = createMockAdapter({ connected: false, publicKey: null });
      const layer = makeSignerServiceFromLegacyAdapter(() => adapter);

      return Effect.gen(function* () {
        const signer = yield* SignerService;
        const exit = yield* Effect.exit(signer.getAddress());

        expectTaggedFailure(exit, "WalletNotConnectedError");
      }).pipe(Effect.provide(layer));
    });

    it.effect("fails when connected but publicKey is null", () => {
      const adapter = createMockAdapter({ connected: true, publicKey: null });
      const layer = makeSignerServiceFromLegacyAdapter(() => adapter);

      return Effect.gen(function* () {
        const signer = yield* SignerService;
        const exit = yield* Effect.exit(signer.getAddress());

        expectTaggedFailure(exit, "WalletNotConnectedError");
      }).pipe(Effect.provide(layer));
    });
  });

  describe("isConnected", () => {
    it.effect("returns true when connected", () => {
      const adapter = createMockAdapter({ connected: true });
      const layer = makeSignerServiceFromLegacyAdapter(() => adapter);

      return Effect.gen(function* () {
        const signer = yield* SignerService;
        const connected = yield* signer.isConnected();

        expect(connected).toBe(true);
      }).pipe(Effect.provide(layer));
    });

    it.effect("returns false when disconnected", () => {
      const adapter = createMockAdapter({ connected: false });
      const layer = makeSignerServiceFromLegacyAdapter(() => adapter);

      return Effect.gen(function* () {
        const signer = yield* SignerService;
        const connected = yield* signer.isConnected();

        expect(connected).toBe(false);
      }).pipe(Effect.provide(layer));
    });
  });

  describe("signTransaction", () => {
    it.effect("converts and signs transaction correctly", () => {
      const adapter = createMockAdapter();
      const layer = makeSignerServiceFromLegacyAdapter(() => adapter);

      return Effect.gen(function* () {
        const legacyTx = createLegacyTx();
        const kitTx = fromWeb3Transaction(legacyTx);

        const signer = yield* SignerService;
        const signed = yield* signer.signTransaction(kitTx);

        // Verify it returned a kit transaction
        expect(signed).toBeDefined();
        expect(typeof signed).toBe("object");
      }).pipe(Effect.provide(layer));
    });

    it.effect("fails with WalletNotConnectedError when disconnected", () => {
      const adapter = createMockAdapter({ connected: false });
      const layer = makeSignerServiceFromLegacyAdapter(() => adapter);

      return Effect.gen(function* () {
        const legacyTx = createLegacyTx();
        const kitTx = fromWeb3Transaction(legacyTx);

        const signer = yield* SignerService;
        const exit = yield* Effect.exit(signer.signTransaction(kitTx));

        expectTaggedFailure(exit, "WalletNotConnectedError");
      }).pipe(Effect.provide(layer));
    });

    it.effect("fails with SignatureError when signing fails", () => {
      const adapter = createMockAdapter({
        signTransaction: () => {
          throw new Error("Signing failed");
        },
      });
      const layer = makeSignerServiceFromLegacyAdapter(() => adapter);

      return Effect.gen(function* () {
        const legacyTx = createLegacyTx();
        const kitTx = fromWeb3Transaction(legacyTx);

        const signer = yield* SignerService;
        const exit = yield* Effect.exit(signer.signTransaction(kitTx));

        expectTaggedFailure(exit, "SignatureError");
      }).pipe(Effect.provide(layer));
    });
  });

  describe("signAllTransactions", () => {
    it.effect("batch signing works correctly", () => {
      const adapter = createMockAdapter();
      const layer = makeSignerServiceFromLegacyAdapter(() => adapter);

      return Effect.gen(function* () {
        // Create two transactions
        const legacyTx1 = createLegacyTx();
        const legacyTx2 = createLegacyTx();
        const kitTx1 = fromWeb3Transaction(legacyTx1);
        const kitTx2 = fromWeb3Transaction(legacyTx2);

        const signer = yield* SignerService;
        const signed = yield* signer.signAllTransactions([kitTx1, kitTx2]);

        expect(signed.length).toBe(2);
        expect(signed[0]).toBeDefined();
        expect(signed[1]).toBeDefined();
      }).pipe(Effect.provide(layer));
    });

    it.effect("fails with WalletNotConnectedError when disconnected", () => {
      const adapter = createMockAdapter({ connected: false });
      const layer = makeSignerServiceFromLegacyAdapter(() => adapter);

      return Effect.gen(function* () {
        const legacyTx = createLegacyTx();
        const kitTx = fromWeb3Transaction(legacyTx);

        const signer = yield* SignerService;
        const exit = yield* Effect.exit(signer.signAllTransactions([kitTx]));

        expectTaggedFailure(exit, "WalletNotConnectedError");
      }).pipe(Effect.provide(layer));
    });

    it.effect("fails with SignatureError when batch signing fails", () => {
      const adapter = createMockAdapter({
        signAllTransactions: () => {
          throw new Error("Batch signing failed");
        },
      });
      const layer = makeSignerServiceFromLegacyAdapter(() => adapter);

      return Effect.gen(function* () {
        const legacyTx = createLegacyTx();
        const kitTx = fromWeb3Transaction(legacyTx);

        const signer = yield* SignerService;
        const exit = yield* Effect.exit(signer.signAllTransactions([kitTx]));

        expectTaggedFailure(exit, "SignatureError");
      }).pipe(Effect.provide(layer));
    });
  });

  describe("adapter state changes", () => {
    it.effect("reflects adapter state changes via getAdapter function", () => {
      let connected = true;
      const mockPk = new PublicKey("DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK");

      // getAdapter is called each time, so it can return updated state
      const layer = makeSignerServiceFromLegacyAdapter(() =>
        createMockAdapter({
          connected,
          publicKey: connected ? mockPk : null,
        })
      );

      return Effect.gen(function* () {
        const signer = yield* SignerService;

        // Initially connected
        const isConnected1 = yield* signer.isConnected();
        expect(isConnected1).toBe(true);

        // Simulate disconnect
        connected = false;

        // Should now be disconnected
        const isConnected2 = yield* signer.isConnected();
        expect(isConnected2).toBe(false);

        // getAddress should fail
        const exit = yield* Effect.exit(signer.getAddress());
        expectTaggedFailure(exit, "WalletNotConnectedError");
      }).pipe(Effect.provide(layer));
    });
  });
});
