import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import type { Hash, Hex } from "viem";
import { safeMultisigBatchWrite } from "./batch.js";
import { SafeMultiSendUnavailableError, SafeMultisigTxSubmissionError } from "./errors.js";
import type { SafeAppsServiceShape } from "./service.js";
import { SafeAppsService } from "./service.js";

const TEST_SAFE_TX_HASH =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as Hash;
const TEST_CHAIN_ID = 1;
const TEST_ADDRESS = "0x0000000000000000000000000000000000000001";
const TEST_MESSAGE_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hex;
const TEST_SIGNATURE = "0xsignature" as Hex;
const TEST_TX = { data: "0x", to: TEST_ADDRESS, value: 0n } as const;

function makeSafeAppsServiceLayer(
  sendTxs: (...args: Parameters<SafeAppsServiceShape["sendTxs"]>) => Effect.Effect<any, unknown>
) {
  const service = SafeAppsService.of({
    enableOffchainSigning: () => Effect.void,
    getInfo: () => Effect.dieMessage("unused in this test"),
    getOffchainSignature: () => Effect.succeed(Option.some(TEST_SIGNATURE)),
    getTx: () => Effect.dieMessage("unused in this test"),
    pollOffchainSignature: () =>
      Effect.succeed({
        messageHash: TEST_MESSAGE_HASH,
        signature: TEST_SIGNATURE,
      }),
    sendTxs,
    signTypedData: () => Effect.dieMessage("unused in this test"),
    waitForTxReceipt: () => Effect.dieMessage("unused in this test"),
  } as unknown as SafeAppsServiceShape);

  return Layer.succeed(SafeAppsService, service);
}

describe("safeMultisigBatchWrite", () => {
  it.effect("does not wrap SafeMultisigTxSubmissionError twice", () =>
    Effect.gen(function* () {
      const message = "Failed to submit txs to Safe: User rejected the request";
      const error = yield* safeMultisigBatchWrite([TEST_TX], TEST_CHAIN_ID).pipe(Effect.flip);

      expect(error).toBeInstanceOf(SafeMultisigTxSubmissionError);
      expect(error.message).toBe(message);
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.fail(
            new SafeMultisigTxSubmissionError({
              cause: { code: 4001 },
              message: "Failed to submit txs to Safe: User rejected the request",
            })
          )
        )
      )
    )
  );

  it.effect("preserves useful details when wrapping generic errors", () =>
    Effect.gen(function* () {
      const error = yield* safeMultisigBatchWrite([TEST_TX], TEST_CHAIN_ID).pipe(Effect.flip);

      expect(error).toBeInstanceOf(SafeMultisigTxSubmissionError);
      expect(error.message).toBe("Safe batch write failed: User rejected the request");
    }).pipe(Effect.provide(makeSafeAppsServiceLayer(() => Effect.fail({ code: 4001 }))))
  );

  it.effect("maps MultiSend deployment failures to SafeMultiSendUnavailableError", () =>
    Effect.gen(function* () {
      const error = yield* safeMultisigBatchWrite([TEST_TX], TEST_CHAIN_ID).pipe(Effect.flip);

      expect(error).toBeInstanceOf(SafeMultiSendUnavailableError);
      expect(error.message).toBe(`MultiSend contract not available on chain ${TEST_CHAIN_ID}`);
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() => Effect.fail(new Error("MultiSend contract not deployed")))
      )
    )
  );

  it.effect("returns the Safe tx hash on success", () =>
    Effect.gen(function* () {
      const safeTxHash = yield* safeMultisigBatchWrite([TEST_TX], TEST_CHAIN_ID);

      expect(safeTxHash).toBe(TEST_SAFE_TX_HASH);
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() =>
          Effect.succeed({
            chainId: TEST_CHAIN_ID,
            safeAddress: TEST_ADDRESS,
            safeTxHash: TEST_SAFE_TX_HASH,
          })
        )
      )
    )
  );
});
