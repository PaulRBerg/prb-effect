import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import type { Hash, Hex, TransactionReceipt } from "viem";
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
      const result = yield* waitForSafeMultisigTx(
        TEST_SAFE_TX_HASH,
        () => Effect.succeed(TEST_RECEIPT),
        {
          interval: "1 second",
          maxWait: "1 minute",
        }
      );

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
      const result = yield* waitForSafeMultisigTx(
        TEST_SAFE_TX_HASH,
        () => Effect.succeed(TEST_RECEIPT),
        {
          interval: "100 millis",
          maxWait: "500 millis",
        }
      );

      expect(result).toEqual({
        _tag: "queued",
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

  it.effect("returns cancelled with null onchainHash when Safe tx is cancelled", () =>
    Effect.gen(function* () {
      const result = yield* waitForSafeMultisigTx(
        TEST_SAFE_TX_HASH,
        () => Effect.succeed(TEST_RECEIPT),
        {
          interval: "1 second",
          maxWait: "1 minute",
        }
      );

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
});
