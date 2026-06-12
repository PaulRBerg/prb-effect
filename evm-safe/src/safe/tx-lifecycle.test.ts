import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import type { Hash, Hex, TransactionReceipt } from "viem";
import { SafeMultisigTxLookupError } from "./errors.js";
import type { SafeAppsServiceShape } from "./service.js";
import { SafeAppsService } from "./service.js";
import { waitForSafeMultisigTx } from "./tx-lifecycle.js";

const TEST_SAFE_TX_HASH =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as Hash;
const TEST_ONCHAIN_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hash;
const TEST_MESSAGE_HASH =
  "0xfeedface1234567890abcdef1234567890abcdef1234567890abcdef12345678" as Hex;
const TEST_SIGNATURE = "0xsignature" as Hex;
const TEST_RECEIPT = {
  status: "success",
  transactionHash: TEST_ONCHAIN_HASH,
} as unknown as TransactionReceipt;
const TEST_REVERTED_RECEIPT = {
  status: "reverted",
  transactionHash: TEST_ONCHAIN_HASH,
} as unknown as TransactionReceipt;

// Shared wait options. `TIMEOUT_OPTIONS` makes the loop exit after one attempt so we can assert
// the timeout branch without burning real wall-clock time in `it.effect` tests.
const DEFAULT_OPTIONS = { interval: "1 second", maxWait: "1 minute" } as const;
const TIMEOUT_OPTIONS = { interval: "1 second", maxWait: "1 second" } as const;
const getReceiptOk = () => Effect.succeed(TEST_RECEIPT);

function makeSafeAppsServiceLayer(
  getTx: (...args: Parameters<SafeAppsServiceShape["getTx"]>) => Effect.Effect<any, unknown>
) {
  const service = SafeAppsService.of({
    enableOffchainSigning: () => Effect.void,
    getInfo: () => Effect.dieMessage("unused in this test"),
    getOffchainSignature: () => Effect.succeed(Option.some(TEST_SIGNATURE)),
    getTx,
    pollOffchainSignature: () =>
      Effect.succeed({
        messageHash: TEST_MESSAGE_HASH,
        signature: TEST_SIGNATURE,
      }),
    sendTxs: () => Effect.dieMessage("unused in this test"),
    signTypedData: () => Effect.dieMessage("unused in this test"),
    waitForTxReceipt: () => Effect.dieMessage("unused in this test"),
  } as unknown as SafeAppsServiceShape);

  return Layer.succeed(SafeAppsService, service);
}

describe("waitForSafeMultisigTx", () => {
  it.effect("returns onchainHash and safeTxHash when Safe tx executes", () =>
    Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(TEST_SAFE_TX_HASH, getReceiptOk, DEFAULT_OPTIONS);

      expect(result).toEqual({
        _tag: "success",
        onchainHash: TEST_ONCHAIN_HASH,
        receipt: TEST_RECEIPT,
        safeTxHash: TEST_SAFE_TX_HASH,
      });
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          })
        )
      )
    )
  );

  it.effect("returns queued with null onchainHash on timeout", () =>
    Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(TEST_SAFE_TX_HASH, getReceiptOk, TIMEOUT_OPTIONS);

      expect(result).toEqual({
        _tag: "queued",
        confirmations: 1,
        confirmationsRequired: 2,
        lastStatus: "awaiting_confirmations",
        onchainHash: null,
        safeTxHash: TEST_SAFE_TX_HASH,
      });
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            confirmations: 1,
            confirmationsRequired: 2,
            onchainHash: Option.none(),
            status: "AWAITING_CONFIRMATIONS",
          })
        )
      )
    )
  );

  it.effect("returns queued awaiting execution progress on timeout", () =>
    Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(TEST_SAFE_TX_HASH, getReceiptOk, TIMEOUT_OPTIONS);

      expect(result).toEqual({
        _tag: "queued",
        confirmations: 2,
        confirmationsRequired: 2,
        lastStatus: "awaiting_execution",
        onchainHash: null,
        safeTxHash: TEST_SAFE_TX_HASH,
      });
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.none(),
            status: "AWAITING_EXECUTION",
          })
        )
      )
    )
  );

  it.effect("returns cancelled with null onchainHash when Safe tx is cancelled", () =>
    Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(TEST_SAFE_TX_HASH, getReceiptOk, DEFAULT_OPTIONS);

      expect(result).toEqual({
        _tag: "cancelled",
        onchainHash: null,
        safeTxHash: TEST_SAFE_TX_HASH,
      });
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            confirmations: 1,
            confirmationsRequired: 2,
            onchainHash: Option.none(),
            status: "CANCELLED",
          })
        )
      )
    )
  );

  it.effect("resolves success when onchainHash present even if status is AWAITING_EXECUTION", () =>
    Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(TEST_SAFE_TX_HASH, getReceiptOk, DEFAULT_OPTIONS);

      expect(result).toEqual({
        _tag: "success",
        onchainHash: TEST_ONCHAIN_HASH,
        receipt: TEST_RECEIPT,
        safeTxHash: TEST_SAFE_TX_HASH,
      });
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "AWAITING_EXECUTION",
          })
        )
      )
    )
  );

  it.effect("resolves success when onchainHash present even if status is PENDING", () =>
    Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(TEST_SAFE_TX_HASH, getReceiptOk, DEFAULT_OPTIONS);

      expect(result).toEqual({
        _tag: "success",
        onchainHash: TEST_ONCHAIN_HASH,
        receipt: TEST_RECEIPT,
        safeTxHash: TEST_SAFE_TX_HASH,
      });
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "PENDING",
          })
        )
      )
    )
  );

  it.effect("resolves failed when receipt status is reverted", () =>
    Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(
        TEST_SAFE_TX_HASH,
        () => Effect.succeed(TEST_REVERTED_RECEIPT),
        DEFAULT_OPTIONS
      );

      expect(result).toEqual({
        _tag: "failed",
        error: `Transaction ${TEST_ONCHAIN_HASH} reverted on-chain`,
        onchainHash: TEST_ONCHAIN_HASH,
        safeTxHash: TEST_SAFE_TX_HASH,
      });
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          })
        )
      )
    )
  );

  it.effect("performs at least one poll when maxWait < interval", () =>
    Effect.gen(function* () {
      let polls = 0;
      const layer = makeSafeAppsServiceLayer(() =>
        Effect.sync(() => {
          polls += 1;
          return {
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          };
        })
      );

      // maxWait (3s) < interval (5s default) => floor(3/5) === 0; Math.max(1, …) keeps one poll.
      const result = yield* waitForSafeMultisigTx(TEST_SAFE_TX_HASH, getReceiptOk, {
        maxWait: "3 seconds",
      }).pipe(Effect.provide(layer));

      expect(polls).toBe(1);
      expect(result).toEqual({
        _tag: "success",
        onchainHash: TEST_ONCHAIN_HASH,
        receipt: TEST_RECEIPT,
        safeTxHash: TEST_SAFE_TX_HASH,
      });
    })
  );

  it.effect("invokes onProgress with each successful poll's info", () =>
    Effect.gen(function* () {
      const seen: string[] = [];
      const result = yield* waitForSafeMultisigTx(TEST_SAFE_TX_HASH, getReceiptOk, {
        ...DEFAULT_OPTIONS,
        onProgress: (info) => Effect.sync(() => seen.push(info.status)),
      });

      expect(seen).toEqual(["SUCCESS"]);
      expect(result._tag).toBe("success");
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          })
        )
      )
    )
  );

  it.effect("swallows onProgress failures without aborting polling", () =>
    Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(TEST_SAFE_TX_HASH, getReceiptOk, {
        ...DEFAULT_OPTIONS,
        onProgress: () => Effect.fail("boom" as never),
      });

      expect(result._tag).toBe("success");
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          })
        )
      )
    )
  );

  it.live("keeps polling when status SUCCESS but onchainHash is None, then resolves", () => {
    let attempt = 0;
    const layer = makeSafeAppsServiceLayer(() =>
      Effect.sync(() => {
        attempt += 1;
        return attempt === 1
          ? {
              confirmations: 2,
              confirmationsRequired: 2,
              onchainHash: Option.none(),
              status: "SUCCESS",
            }
          : {
              confirmations: 2,
              confirmationsRequired: 2,
              onchainHash: Option.some(TEST_ONCHAIN_HASH),
              status: "SUCCESS",
            };
      })
    );

    return Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(TEST_SAFE_TX_HASH, getReceiptOk, DEFAULT_OPTIONS);

      expect(result).toEqual({
        _tag: "success",
        onchainHash: TEST_ONCHAIN_HASH,
        receipt: TEST_RECEIPT,
        safeTxHash: TEST_SAFE_TX_HASH,
      });
      expect(attempt).toBeGreaterThanOrEqual(2);
    }).pipe(Effect.provide(layer));
  });

  it.effect("returns failed when status is FAILED with no onchainHash", () =>
    Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(TEST_SAFE_TX_HASH, getReceiptOk, DEFAULT_OPTIONS);

      expect(result).toEqual({
        _tag: "failed",
        error: "Safe transaction failed",
        onchainHash: null,
        safeTxHash: TEST_SAFE_TX_HASH,
      });
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            confirmations: 1,
            confirmationsRequired: 2,
            onchainHash: Option.none(),
            status: "FAILED",
          })
        )
      )
    )
  );

  it.live("retries getReceipt when it errors with retryable=true, then resolves success", () => {
    let receiptAttempts = 0;
    return Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(
        TEST_SAFE_TX_HASH,
        () =>
          Effect.suspend(() => {
            receiptAttempts += 1;
            if (receiptAttempts === 1) {
              return Effect.fail(
                new SafeMultisigTxLookupError({
                  message: "receipt not yet available",
                  retryable: true,
                  safeTxHash: TEST_SAFE_TX_HASH,
                })
              );
            }
            return Effect.succeed(TEST_RECEIPT);
          }),
        DEFAULT_OPTIONS
      );

      expect(result).toEqual({
        _tag: "success",
        onchainHash: TEST_ONCHAIN_HASH,
        receipt: TEST_RECEIPT,
        safeTxHash: TEST_SAFE_TX_HASH,
      });
      expect(receiptAttempts).toBeGreaterThanOrEqual(2);
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "AWAITING_EXECUTION",
          })
        )
      )
    );
  });
});
