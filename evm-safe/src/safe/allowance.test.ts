import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import type { Address, Hash, Hex } from "viem";
import { safeMultisigAllowAndWrite } from "./allowance.js";
import { SafeMultiSendUnavailableError } from "./errors.js";
import type { SafeAppsServiceShape } from "./service.js";
import { SafeAppsService } from "./service.js";

const TEST_MAIN_TX = {
  data: "0x1234" as Hex,
  to: "0x0000000000000000000000000000000000000002" as Address,
  value: 0n,
};

const TEST_PARAMS = {
  amount: 1n,
  mainTransaction: TEST_MAIN_TX,
  spender: "0x0000000000000000000000000000000000000003" as Address,
  token: {
    address: "0x0000000000000000000000000000000000000004" as Address,
    chainId: 1,
  },
};

const TEST_MESSAGE_HASH =
  "0xfeedface1234567890abcdef1234567890abcdef1234567890abcdef12345678" as Hex;
const TEST_SIGNATURE = "0xsignature" as Hex;

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

describe("safeMultisigAllowAndWrite", () => {
  it.effect("fails deterministically when multiSendStrategy is require", () =>
    Effect.gen(function* () {
      const error = yield* safeMultisigAllowAndWrite({
        ...TEST_PARAMS,
        multiSendStrategy: "require",
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(SafeMultiSendUnavailableError);
    }).pipe(
      Effect.provide(
        makeSafeAppsServiceLayer(() => Effect.fail(new Error("MultiSend contract not deployed")))
      )
    )
  );

  it.effect("returns typed fallback outcome when MultiSend is unavailable", () =>
    (() => {
      let call = 0;
      const hashes = [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ] as const;

      return Effect.gen(function* () {
        const result = yield* safeMultisigAllowAndWrite({
          ...TEST_PARAMS,
          multiSendStrategy: "fallback-required-approval",
        });

        expect(call).toBe(3);
        expect(result).toEqual({
          _tag: "fallback-required-approval",
          approveSafeTxHash: hashes[0] as Hash,
          mainSafeTxHash: hashes[1] as Hash,
        });
      }).pipe(
        Effect.provide(
          makeSafeAppsServiceLayer((_txs) =>
            Effect.gen(function* () {
              if (call === 0) {
                call += 1;
                return yield* Effect.fail(new Error("MultiSend contract not deployed"));
              }

              const hash = hashes[call - 1];
              call += 1;
              return {
                chainId: 1,
                safeAddress: "0x0000000000000000000000000000000000000001" as Address,
                safeTxHash: hash as Hash,
              };
            })
          )
        )
      );
    })()
  );
});
