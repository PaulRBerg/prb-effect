// @vitest-environment jsdom
import { describe, expect, it } from "@effect/vitest";
import {
  TEST_ADDRESS,
  TEST_CHAIN_ID,
  TEST_RECEIPT,
  TEST_TX_HASH,
} from "@prb/effect-evm/testing-kit";
import { TxManager } from "@prb/effect-evm/tx";
import { Effect, Fiber, Layer, Option, TestClock } from "effect";
import { afterEach, beforeEach, vi } from "vitest";
import type { SafeAppsSDKInstance } from "./adapter.js";
import type { EIP712TypedData } from "./types.js";

vi.mock("./adapter.js", () => ({
  loadSafeSdk: () => Effect.succeed(sdk as unknown as SafeAppsSDKInstance),
}));

const { SafeAppsServiceLive } = await import("./live.js");
const { SafeAppsService } = await import("./service.js");

const SAFE_TX_HASH = `0x${"ab".repeat(32)}` as const;
const MESSAGE_HASH = `0x${"cd".repeat(32)}` as const;
const SIGNATURE = "0x1234";
const TYPED_DATA: EIP712TypedData = {
  domain: { chainId: TEST_CHAIN_ID, name: "Test" },
  message: { value: "test" },
  types: { Test: [{ name: "value", type: "string" }] },
};

function makeSdk() {
  return {
    eth: { setSafeSettings: vi.fn(async () => undefined) },
    safe: {
      getInfo: vi.fn(async () => ({ chainId: TEST_CHAIN_ID, safeAddress: TEST_ADDRESS as string })),
      getOffChainSignature: vi.fn<() => Promise<string | undefined>>(async () => SIGNATURE),
    },
    txs: {
      getBySafeTxHash: vi.fn<() => Promise<unknown>>(async () => ({
        txHash: TEST_TX_HASH,
        txStatus: "SUCCESS",
        detailedExecutionInfo: {
          confirmations: [{ signer: TEST_ADDRESS }],
          confirmationsRequired: 2,
          type: "MULTISIG",
        },
      })),
      send: vi.fn(async () => ({ safeTxHash: SAFE_TX_HASH as string })),
      signTypedMessage: vi.fn<() => Promise<unknown>>(async () => ({ safeTxHash: SAFE_TX_HASH })),
    },
  };
}

let sdk = makeSdk();
const waitForReceipt = vi.fn<TxManager["Type"]["waitForReceipt"]>(() =>
  Effect.succeed(TEST_RECEIPT)
);

function serviceLayer() {
  return SafeAppsServiceLive().pipe(
    Layer.provide(
      Layer.succeed(TxManager, {
        getConfirmations: () => Effect.dieMessage("unused"),
        track: () => Effect.dieMessage("unused"),
        waitForReceipt,
      })
    )
  );
}

beforeEach(() => {
  sdk = makeSdk();
  waitForReceipt.mockClear();
  Object.defineProperty(window, "parent", { configurable: true, value: {} });
});

afterEach(() => {
  Object.defineProperty(window, "parent", { configurable: true, value: window });
});

describe("SafeAppsServiceLive SDK operations", () => {
  it.effect("validates and caches Safe info after the first SDK call", () =>
    Effect.gen(function* () {
      const service = yield* SafeAppsService;
      expect(yield* service.getInfo()).toEqual({
        chainId: TEST_CHAIN_ID,
        safeAddress: TEST_ADDRESS,
      });
      yield* service.getInfo();
      expect(sdk.safe.getInfo).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("rejects an invalid Safe address from the SDK", () =>
    Effect.gen(function* () {
      sdk.safe.getInfo.mockResolvedValue({ chainId: TEST_CHAIN_ID, safeAddress: "invalid" });
      const service = yield* SafeAppsService;
      const error = yield* service.getInfo().pipe(Effect.flip);
      expect(error._tag).toBe("SafeMultisigInfoUnavailableError");
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("converts transaction values to decimal strings and forwards gas options", () =>
    Effect.gen(function* () {
      const service = yield* SafeAppsService;
      const result = yield* service.sendTxs(
        [
          { data: "0x12", to: TEST_ADDRESS, value: 42n },
          { data: "0x", to: TEST_ADDRESS },
        ],
        { safeTxGas: 123 }
      );
      expect(sdk.txs.send).toHaveBeenCalledWith({
        params: { safeTxGas: 123 },
        txs: [
          { data: "0x12", to: TEST_ADDRESS, value: "42" },
          { data: "0x", to: TEST_ADDRESS, value: "0" },
        ],
      });
      expect(result).toEqual({
        chainId: TEST_CHAIN_ID,
        safeAddress: TEST_ADDRESS,
        safeTxHash: SAFE_TX_HASH,
      });
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("maps transaction rejection to UserRejectedError", () =>
    Effect.gen(function* () {
      sdk.txs.send.mockRejectedValue({ code: 4001, message: "Rejected" });
      const service = yield* SafeAppsService;
      const error = yield* service.sendTxs([]).pipe(Effect.flip);
      expect(error._tag).toBe("UserRejectedError");
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("rejects an invalid submitted Safe transaction hash", () =>
    Effect.gen(function* () {
      sdk.txs.send.mockResolvedValue({ safeTxHash: "0x1234" });
      const service = yield* SafeAppsService;
      const error = yield* service.sendTxs([]).pipe(Effect.flip);
      expect(error._tag).toBe("SafeMultisigTxSubmissionError");
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("extracts execution hash and multisig confirmation counts", () =>
    Effect.gen(function* () {
      const service = yield* SafeAppsService;
      expect(yield* service.getTx(SAFE_TX_HASH)).toEqual({
        confirmations: 1,
        confirmationsRequired: 2,
        onchainHash: Option.some(TEST_TX_HASH),
        status: "SUCCESS",
      });
      expect(sdk.txs.getBySafeTxHash).toHaveBeenCalledWith(SAFE_TX_HASH);
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("defaults missing execution data to a pending transaction", () =>
    Effect.gen(function* () {
      sdk.txs.getBySafeTxHash.mockResolvedValue({});
      const service = yield* SafeAppsService;
      expect(yield* service.getTx(SAFE_TX_HASH)).toEqual({
        confirmations: null,
        confirmationsRequired: null,
        onchainHash: Option.none(),
        status: "AWAITING_CONFIRMATIONS",
      });
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("rejects an invalid on-chain transaction hash", () =>
    Effect.gen(function* () {
      sdk.txs.getBySafeTxHash.mockResolvedValue({ txHash: "0x1234" });
      const service = yield* SafeAppsService;
      const error = yield* service.getTx(SAFE_TX_HASH).pipe(Effect.flip);
      expect(error._tag).toBe("SafeMultisigTxLookupError");
      expect(error.retryable).toBe(false);
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("delegates receipt waiting with the resolved chain, hash, and receipt policy", () =>
    Effect.gen(function* () {
      const service = yield* SafeAppsService;
      const receiptPolicy = { pollingInterval: 12, receiptTimeout: 34 };
      const result = yield* service.waitForTxReceipt(SAFE_TX_HASH, { receiptPolicy });
      expect(waitForReceipt).toHaveBeenCalledWith(TEST_CHAIN_ID, TEST_TX_HASH, receiptPolicy);
      expect(result).toEqual({
        chainId: TEST_CHAIN_ID,
        onchainHash: TEST_TX_HASH,
        receipt: TEST_RECEIPT,
        safeAddress: TEST_ADDRESS,
        safeTxHash: SAFE_TX_HASH,
      });
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect.each([
    [{ safeTxHash: SAFE_TX_HASH }, { _tag: "Onchain", safeTxHash: SAFE_TX_HASH }],
    [{ messageHash: MESSAGE_HASH }, { _tag: "Offchain", messageHash: MESSAGE_HASH }],
  ])("maps SDK signing result %j to its tagged variant", ([response, expected]) =>
    Effect.gen(function* () {
      sdk.txs.signTypedMessage.mockResolvedValue(response);
      const service = yield* SafeAppsService;
      expect(yield* service.signTypedData(TYPED_DATA)).toEqual(expected);
      expect(sdk.txs.signTypedMessage).toHaveBeenCalledWith(TYPED_DATA);
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect.each(["", "0x"])("treats empty signature %j as unavailable", (signature) =>
    Effect.gen(function* () {
      sdk.safe.getOffChainSignature.mockResolvedValue(signature);
      const service = yield* SafeAppsService;
      expect(yield* service.getOffchainSignature(MESSAGE_HASH)).toEqual(Option.none());
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("returns available signatures as Option.some", () =>
    Effect.gen(function* () {
      const service = yield* SafeAppsService;
      expect(yield* service.getOffchainSignature(MESSAGE_HASH)).toEqual(Option.some(SIGNATURE));
      expect(sdk.safe.getOffChainSignature).toHaveBeenCalledWith(MESSAGE_HASH);
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("rejects malformed signature data", () =>
    Effect.gen(function* () {
      sdk.safe.getOffChainSignature.mockResolvedValue("invalid");
      const service = yield* SafeAppsService;
      const error = yield* service.getOffchainSignature(MESSAGE_HASH).pipe(Effect.flip);
      expect(error._tag).toBe("SafeMultisigTxLookupError");
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("polls until an off-chain signature becomes available", () =>
    Effect.gen(function* () {
      sdk.safe.getOffChainSignature.mockResolvedValueOnce("0x");
      const service = yield* SafeAppsService;
      const fiber = yield* Effect.fork(
        service.pollOffchainSignature(MESSAGE_HASH, { pollInterval: 10, timeout: 100 })
      );
      yield* TestClock.adjust("10 millis");
      expect(yield* Fiber.join(fiber)).toEqual({ messageHash: MESSAGE_HASH, signature: SIGNATURE });
      expect(sdk.safe.getOffChainSignature).toHaveBeenCalledTimes(2);
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("enables off-chain signing through SDK settings", () =>
    Effect.gen(function* () {
      const service = yield* SafeAppsService;
      yield* service.enableOffchainSigning();
      expect(sdk.eth.setSafeSettings).toHaveBeenCalledWith([{ offChainSigning: true }]);
    }).pipe(Effect.provide(serviceLayer()))
  );

  it.effect("maps SDK settings failures to a typed error", () =>
    Effect.gen(function* () {
      const cause = new Error("host disconnected");
      sdk.eth.setSafeSettings.mockRejectedValue(cause);
      const service = yield* SafeAppsService;
      const error = yield* service.enableOffchainSigning().pipe(Effect.flip);
      expect(error._tag).toBe("SafeMultisigSettingsError");
      expect(error.cause).toBe(cause);
    }).pipe(Effect.provide(serviceLayer()))
  );
});
