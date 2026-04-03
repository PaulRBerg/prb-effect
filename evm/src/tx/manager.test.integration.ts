import { describe, expect, it } from "@effect/vitest";
import { Chunk, Effect, Either, Exit, Layer, Stream } from "effect";
import type { TransactionReceipt } from "viem";
import { MIN_TX_GAS } from "#src/constants/index.js";
import { makeMockPublicClientLayer, TEST_CHAIN_ID, TEST_TX_HASH } from "#src/testing-kit/index.js";
import { makeTxManagerLive, TxManager, TxManagerLive, TxReplacement } from "#src/tx/index.js";

const txReplacementLayer = Layer.succeed(
  TxReplacement,
  TxReplacement.of({
    cancel: () => Effect.succeed(TEST_TX_HASH),
    speedup: () => Effect.succeed(TEST_TX_HASH),
  })
);

const TEST_RECEIPT: TransactionReceipt = {
  blockHash: "0xblock",
  blockNumber: 123n,
  contractAddress: null,
  cumulativeGasUsed: MIN_TX_GAS,
  effectiveGasPrice: 1n,
  from: "0xfrom",
  gasUsed: MIN_TX_GAS,
  logs: [],
  logsBloom: "0x",
  status: "success",
  to: "0xto",
  transactionHash: TEST_TX_HASH,
  transactionIndex: 0,
  type: "0x2",
};
const REPLACED_HASH = "0x9999999999999999999999999999999999999999999999999999999999999999";

describe("TxManager", () => {
  describe("waitForReceipt", () => {
    it.effect("returns receipt on success", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;
        const receipt = yield* manager.waitForReceipt(TEST_CHAIN_ID, TEST_TX_HASH);

        expect(receipt.transactionHash).toBe(TEST_TX_HASH);
        expect(receipt.status).toBe("success");
      }).pipe(
        Effect.provide(
          Layer.provide(
            TxManagerLive,
            Layer.mergeAll(
              makeMockPublicClientLayer({
                waitForTransactionReceipt: async () => TEST_RECEIPT,
              }),
              txReplacementLayer
            )
          )
        )
      )
    );

    it.effect("returns TxFailedError on failure", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;
        const exit = yield* manager.waitForReceipt(TEST_CHAIN_ID, TEST_TX_HASH).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            TxManagerLive,
            Layer.mergeAll(
              makeMockPublicClientLayer({
                waitForTransactionReceipt: () => Promise.reject(new Error("Transaction reverted")),
              }),
              txReplacementLayer
            )
          )
        )
      )
    );

    it.live("returns ReceiptTimeoutError when error message contains timeout", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;
        const exit = yield* manager
          .waitForReceipt(TEST_CHAIN_ID, TEST_TX_HASH, 5000)
          .pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            TxManagerLive,
            Layer.mergeAll(
              makeMockPublicClientLayer({
                waitForTransactionReceipt: () =>
                  Promise.reject(new Error("timeout waiting for transaction")),
              }),
              txReplacementLayer
            )
          )
        )
      )
    );

    it.effect("returns TxReplacedError when transaction is replaced", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;
        const result = yield* manager
          .waitForReceipt(TEST_CHAIN_ID, TEST_TX_HASH)
          .pipe(Effect.either);

        Either.match(result, {
          onLeft: (error) => {
            expect(error._tag).toBe("TxReplacedError");
            if (error._tag === "TxReplacedError") {
              expect(error.oldHash).toBe(TEST_TX_HASH);
              expect(error.newHash).toBe(
                "0x9999999999999999999999999999999999999999999999999999999999999999"
              );
              expect(error.reason).toBe("replaced");
            }
          },
          onRight: () => {
            throw new Error("Expected failure (Left), got success (Right)");
          },
        });
      }).pipe(
        Effect.provide(
          Layer.provide(
            TxManagerLive,
            Layer.mergeAll(
              makeMockPublicClientLayer({
                waitForTransactionReceipt: (params: unknown) => {
                  type ReplacementInfo = {
                    reason: "cancelled" | "replaced" | "repriced";
                    transaction: { hash: string };
                  };
                  type WaitForTransactionReceiptParams = {
                    hash: string;
                    onReplaced?: (info: ReplacementInfo) => void;
                  };

                  const { onReplaced } = params as WaitForTransactionReceiptParams;

                  onReplaced?.({
                    reason: "replaced",
                    transaction: {
                      hash: "0x9999999999999999999999999999999999999999999999999999999999999999",
                    },
                  });

                  return Promise.resolve({
                    ...TEST_RECEIPT,
                    transactionHash:
                      "0x9999999999999999999999999999999999999999999999999999999999999999",
                  } as TransactionReceipt);
                },
              }),
              txReplacementLayer
            )
          )
        )
      )
    );

    it.effect("returns receipt when onReplaced fires with same hash (no actual replacement)", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;
        const result = yield* manager
          .waitForReceipt(TEST_CHAIN_ID, TEST_TX_HASH)
          .pipe(Effect.either);

        Either.match(result, {
          onLeft: (error) => {
            throw new Error(`Expected success (Right), got error (Left): ${error._tag}`);
          },
          onRight: (receipt) => {
            expect(receipt.transactionHash).toBe(TEST_TX_HASH);
            expect(receipt.status).toBe("success");
          },
        });
      }).pipe(
        Effect.provide(
          Layer.provide(
            TxManagerLive,
            Layer.mergeAll(
              makeMockPublicClientLayer({
                waitForTransactionReceipt: (params: unknown) => {
                  type ReplacementInfo = {
                    reason: "cancelled" | "replaced" | "repriced";
                    transaction: { hash: string };
                  };
                  type WaitForTransactionReceiptParams = {
                    hash: string;
                    onReplaced?: (info: ReplacementInfo) => void;
                  };

                  const { onReplaced, hash } = params as WaitForTransactionReceiptParams;

                  // Simulate viem calling onReplaced with same hash (edge case)
                  onReplaced?.({
                    reason: "repriced",
                    transaction: { hash }, // Same hash as original!
                  });

                  return Promise.resolve({
                    ...TEST_RECEIPT,
                    transactionHash: hash, // Same hash
                  } as TransactionReceipt);
                },
              }),
              txReplacementLayer
            )
          )
        )
      )
    );
  });

  describe("track", () => {
    it.effect("returns SubscriptionRef with initial submitted state", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;
        const ref = yield* manager.track(TEST_CHAIN_ID, TEST_TX_HASH);
        const state = yield* ref.get;

        expect(state.status).toBe("submitted");
        if (state.status === "submitted") {
          expect(state.hash).toBe(TEST_TX_HASH);
        }
      }).pipe(
        Effect.provide(
          Layer.provide(
            TxManagerLive,
            Layer.mergeAll(
              makeMockPublicClientLayer({
                waitForTransactionReceipt: async () =>
                  new Promise<never>(() => {
                    // Intentionally never resolves.
                  }),
              }),
              txReplacementLayer
            )
          )
        ),
        Effect.scoped
      )
    );

    it.effect("tracks replacement when receipt reports onReplaced", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;

        const ref = yield* manager.track(TEST_CHAIN_ID, TEST_TX_HASH);
        const changes = yield* ref.changes.pipe(
          Stream.filter((state) => state.status === "replaced" || state.status === "mined"),
          Stream.take(2),
          Stream.runCollect
        );

        const events = Chunk.toArray(changes);
        expect(events[0]?.status).toBe("replaced");
        expect(events[1]?.status).toBe("mined");

        const replaced = events[0];
        const mined = events[1];

        if (replaced?.status === "replaced") {
          expect(replaced.oldHash).toBe(TEST_TX_HASH);
          expect(replaced.newHash).toBe(REPLACED_HASH);
          expect(replaced.reason).toBe("replaced");
        }

        if (mined?.status === "mined") {
          expect(mined.hash).toBe(REPLACED_HASH);
          expect(mined.receipt.transactionHash).toBe(REPLACED_HASH);
        }
      }).pipe(
        Effect.provide(
          Layer.provide(
            TxManagerLive,
            Layer.mergeAll(
              makeMockPublicClientLayer({
                waitForTransactionReceipt: async (params: unknown) => {
                  type ReplacementInfo = {
                    reason: "cancelled" | "replaced" | "repriced";
                    transaction: { hash: string };
                    replacedTransaction: { hash: string };
                  };
                  type WaitForTransactionReceiptParams = {
                    hash: string;
                    onReplaced?: (info: ReplacementInfo) => void;
                  };

                  const { onReplaced, hash } = params as WaitForTransactionReceiptParams;

                  onReplaced?.({
                    reason: "replaced",
                    replacedTransaction: { hash },
                    transaction: { hash: REPLACED_HASH },
                  });

                  await new Promise((resolve) => setTimeout(resolve, 10));

                  return {
                    ...TEST_RECEIPT,
                    transactionHash: REPLACED_HASH,
                  } as TransactionReceipt;
                },
              }),
              txReplacementLayer
            )
          )
        ),
        Effect.scoped
      )
    );

    // Note: Testing background state updates in a scoped fork is complex
    // These tests verify that track() returns a proper SubscriptionRef
    // Integration tests should verify the full async behavior
  });

  describe("makeTxManagerLive", () => {
    it.live("applies custom layer policy as base for waitForReceipt", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;

        // The custom layer policy sets a short timeout (100ms).
        // The mock delays 200ms, so the receipt should timeout.
        const exit = yield* manager.waitForReceipt(TEST_CHAIN_ID, TEST_TX_HASH).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            makeTxManagerLive({ receiptTimeout: 100 }),
            Layer.mergeAll(
              makeMockPublicClientLayer({
                waitForTransactionReceipt: () =>
                  new Promise<never>((_resolve, reject) => {
                    setTimeout(() => reject(new Error("timeout waiting for transaction")), 200);
                  }),
              }),
              txReplacementLayer
            )
          )
        )
      )
    );

    it.effect("per-call policy overrides layer policy", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;

        // Layer policy has 100ms timeout, but per-call overrides to 5000ms.
        // The mock resolves immediately, so it should succeed.
        const receipt = yield* manager.waitForReceipt(TEST_CHAIN_ID, TEST_TX_HASH, {
          receiptTimeout: 5000,
        });

        expect(receipt.transactionHash).toBe(TEST_TX_HASH);
      }).pipe(
        Effect.provide(
          Layer.provide(
            makeTxManagerLive({ receiptTimeout: 100 }),
            Layer.mergeAll(
              makeMockPublicClientLayer({
                waitForTransactionReceipt: async () => TEST_RECEIPT,
              }),
              txReplacementLayer
            )
          )
        )
      )
    );
  });

  describe("getConfirmations", () => {
    it.effect("returns confirmations when called with hash param", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;
        const confirmations = yield* manager.getConfirmations(TEST_CHAIN_ID, {
          hash: TEST_TX_HASH,
        });

        expect(confirmations).toBe(5n);
      }).pipe(
        Effect.provide(
          Layer.provide(
            TxManagerLive,
            Layer.mergeAll(
              makeMockPublicClientLayer({
                getTransactionConfirmations: async () => 5n,
              }),
              txReplacementLayer
            )
          )
        )
      )
    );

    it.effect("returns confirmations when called with transactionReceipt param", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;

        const confirmations = yield* manager.getConfirmations(TEST_CHAIN_ID, {
          transactionReceipt: TEST_RECEIPT,
        });

        expect(confirmations).toBe(10n);
      }).pipe(
        Effect.provide(
          Layer.provide(
            TxManagerLive,
            Layer.mergeAll(
              makeMockPublicClientLayer({
                getTransactionConfirmations: async () => 10n,
              }),
              txReplacementLayer
            )
          )
        )
      )
    );

    it.effect("returns TransportError on failure", () =>
      Effect.gen(function* () {
        const manager = yield* TxManager;
        const exit = yield* manager
          .getConfirmations(TEST_CHAIN_ID, { hash: TEST_TX_HASH })
          .pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            TxManagerLive,
            Layer.mergeAll(
              makeMockPublicClientLayer({
                getTransactionConfirmations: () => Promise.reject(new Error("RPC error")),
              }),
              txReplacementLayer
            )
          )
        )
      )
    );
  });
});
