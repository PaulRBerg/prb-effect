import { describe, expect, it } from "@effect/vitest";
import type { Instruction } from "@solana/instructions";
import { PublicKey } from "@solana/web3.js";
import { Effect, Layer } from "effect";
import { vi } from "vitest";
import { SYSTEM_PROGRAM_ADDRESS } from "#src/constants/index.js";
import {
  expectTaggedFailure,
  makeMockRpc,
  makeMockRpcServiceLayer,
  TEST_SIGNATURE,
} from "#src/testing-kit/index.js";
import {
  TransactionService,
  TransactionServiceWithWalletLive,
  WalletSendService,
} from "#src/tx/index.js";
import { createLegacyTransaction } from "./_fixtures.js";
import { makeWalletSendServiceFromAppKitProvider } from "./appkit-sender.js";
import { makeSignerServiceFromWeb3Adapter } from "./legacy-signer.js";
import { fromWeb3Transaction } from "./tx-bridge.js";
import type { AppKitSolanaProvider } from "./types.js";

describe("appkit-sender (compat)", () => {
  const connection = { rpcEndpoint: "https://api.devnet.solana.com" };
  const kitTx = fromWeb3Transaction(createLegacyTransaction());

  const makeInstruction = (): Instruction => ({
    accounts: [],
    data: new Uint8Array(),
    programAddress: SYSTEM_PROGRAM_ADDRESS,
  });

  const createProvider = (overrides: Partial<AppKitSolanaProvider> = {}): AppKitSolanaProvider => ({
    connected: true,
    publicKey: new PublicKey("DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK"),
    sendTransaction: vi.fn(async () => TEST_SIGNATURE),
    ...overrides,
  });

  it.effect("sends with provider sendTransaction and returns its signature", () => {
    const provider = createProvider();
    const layer = makeWalletSendServiceFromAppKitProvider(
      () => provider,
      () => connection
    );

    return Effect.gen(function* () {
      const sender = yield* WalletSendService;
      const result = yield* sender.sendTransaction(kitTx, { skipPreflight: true });

      expect(result).toBe(TEST_SIGNATURE);
      expect(provider.sendTransaction).toHaveBeenCalledWith(expect.anything(), connection, {
        skipPreflight: true,
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails with WalletCapabilityError when sendTransaction is unavailable", () => {
    const provider = createProvider({ sendTransaction: undefined });
    const layer = makeWalletSendServiceFromAppKitProvider(
      () => provider,
      () => connection
    );

    return Effect.gen(function* () {
      const sender = yield* WalletSendService;
      const exit = yield* Effect.exit(sender.sendTransaction(kitTx));

      expectTaggedFailure(exit, "WalletCapabilityError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails with UserRejectedError for AppKit rejection errors", () => {
    const provider = createProvider({
      sendTransaction: vi.fn(() =>
        Promise.reject(Object.assign(new Error("User rejected the request"), { code: 4001 }))
      ),
    });
    const layer = makeWalletSendServiceFromAppKitProvider(
      () => provider,
      () => connection
    );

    return Effect.gen(function* () {
      const sender = yield* WalletSendService;
      const exit = yield* Effect.exit(sender.sendTransaction(kitTx));

      expectTaggedFailure(exit, "UserRejectedError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("supports send-only AppKit providers through TransactionService", () => {
    const provider = createProvider();
    const layer = Layer.provide(
      TransactionServiceWithWalletLive,
      Layer.mergeAll(
        makeMockRpcServiceLayer({ getRpc: () => Effect.succeed(makeMockRpc()) }),
        makeSignerServiceFromWeb3Adapter(() => provider),
        makeWalletSendServiceFromAppKitProvider(
          () => provider,
          () => connection
        )
      )
    );

    return Effect.gen(function* () {
      const tx = yield* TransactionService;
      const receipt = yield* tx.sendAndConfirmWithWallet([makeInstruction()]);

      expect(receipt.signature).toBe(TEST_SIGNATURE);
      expect(provider.sendTransaction).toHaveBeenCalledOnce();
    }).pipe(Effect.provide(layer));
  });
});
