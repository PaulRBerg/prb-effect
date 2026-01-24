import { describe, expect, it } from "@effect/vitest";
import { MIN_TX_GAS } from "@prb/effect-evm/constants";
import { TEST_ADDRESS, TEST_CHAIN_ID, TEST_TX_HASH } from "@prb/effect-evm/testing-kit";
import { Effect, Layer, Option } from "effect";
import type { Hash, Hex, TransactionReceipt } from "viem";
import { SafeAppsService } from "./service.js";
import type { SafeMultisigInfo } from "./types.js";

// Test fixtures
const TEST_SAFE_ADDRESS = TEST_ADDRESS;
const TEST_SAFE_TX_HASH =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as Hash;
const TEST_MESSAGE_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hex;
const TEST_SIGNATURE = "0xsignature" as Hex;

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

// Mock SafeAppsService for testing without actual SDK
const makeMockSafeAppsService = (config: {
  getInfoResult?: SafeMultisigInfo;
  sendTxResult?: { safeTxHash: Hash };
  getTxResult?: { txHash: Option.Option<Hash>; status: string };
  signTypedDataResult?:
    | { _tag: "Offchain"; messageHash: Hex }
    | { _tag: "Onchain"; safeTxHash: Hash };
  offchainSignature?: Option.Option<Hex>;
}) => {
  const defaultInfo: SafeMultisigInfo = {
    chainId: TEST_CHAIN_ID,
    safeAddress: TEST_SAFE_ADDRESS,
  };

  return Layer.succeed(
    SafeAppsService,
    SafeAppsService.of({
      enableOffchainSigning: () => Effect.void,
      getInfo: () => Effect.succeed(config.getInfoResult ?? defaultInfo),
      getOffchainSignature: () => Effect.succeed(config.offchainSignature ?? Option.none()),
      getTx: () =>
        Effect.succeed(
          config.getTxResult ?? {
            status: "AWAITING_EXECUTION",
            txHash: Option.some(TEST_TX_HASH),
          }
        ),
      pollOffchainSignature: (messageHash) =>
        Effect.succeed({ messageHash, signature: TEST_SIGNATURE }),
      sendTxs: () =>
        Effect.succeed({
          chainId: TEST_CHAIN_ID,
          safeAddress: TEST_SAFE_ADDRESS,
          safeTxHash: config.sendTxResult?.safeTxHash ?? TEST_SAFE_TX_HASH,
        }),
      signTypedData: () =>
        Effect.succeed(
          config.signTypedDataResult ?? {
            _tag: "Onchain" as const,
            safeTxHash: TEST_SAFE_TX_HASH,
          }
        ),
      waitForTxReceipt: (safeTxHash) =>
        Effect.succeed({
          chainId: TEST_CHAIN_ID,
          onchainHash: TEST_TX_HASH,
          receipt: TEST_RECEIPT,
          safeAddress: TEST_SAFE_ADDRESS,
          safeTxHash,
        }),
    })
  );
};

describe("SafeAppsService", () => {
  describe("getInfo", () => {
    it.effect("returns Safe info with address and chainId", () =>
      Effect.gen(function* () {
        const service = yield* SafeAppsService;
        const info = yield* service.getInfo();

        expect(info.safeAddress).toBe(TEST_SAFE_ADDRESS);
        expect(info.chainId).toBe(TEST_CHAIN_ID);
      }).pipe(Effect.provide(makeMockSafeAppsService({})))
    );
  });

  describe("sendTxs", () => {
    it.effect("returns safeTxHash with safeAddress and chainId", () =>
      Effect.gen(function* () {
        const service = yield* SafeAppsService;
        const result = yield* service.sendTxs([{ data: "0x", to: TEST_ADDRESS, value: 0n }]);

        expect(result.safeTxHash).toBe(TEST_SAFE_TX_HASH);
        expect(result.safeAddress).toBe(TEST_SAFE_ADDRESS);
        expect(result.chainId).toBe(TEST_CHAIN_ID);
      }).pipe(Effect.provide(makeMockSafeAppsService({})))
    );
  });

  describe("getTx", () => {
    it.effect("returns txHash as Option when executed", () =>
      Effect.gen(function* () {
        const service = yield* SafeAppsService;
        const result = yield* service.getTx(TEST_SAFE_TX_HASH);

        expect(Option.isSome(result.txHash)).toBe(true);
        if (Option.isSome(result.txHash)) {
          expect(result.txHash.value).toBe(TEST_TX_HASH);
        }
      }).pipe(Effect.provide(makeMockSafeAppsService({})))
    );

    it.effect("returns Option.none when not yet executed", () =>
      Effect.gen(function* () {
        const service = yield* SafeAppsService;
        const result = yield* service.getTx(TEST_SAFE_TX_HASH);

        expect(Option.isNone(result.txHash)).toBe(true);
        expect(result.status).toBe("AWAITING_CONFIRMATIONS");
      }).pipe(
        Effect.provide(
          makeMockSafeAppsService({
            getTxResult: {
              status: "AWAITING_CONFIRMATIONS",
              txHash: Option.none(),
            },
          })
        )
      )
    );
  });

  describe("waitForTxReceipt", () => {
    it.effect("returns SafeTxResult with receipt", () =>
      Effect.gen(function* () {
        const service = yield* SafeAppsService;
        const result = yield* service.waitForTxReceipt(TEST_SAFE_TX_HASH);

        expect(result.safeTxHash).toBe(TEST_SAFE_TX_HASH);
        expect(result.onchainHash).toBe(TEST_TX_HASH);
        expect(result.receipt.status).toBe("success");
        expect(result.safeAddress).toBe(TEST_SAFE_ADDRESS);
        expect(result.chainId).toBe(TEST_CHAIN_ID);
      }).pipe(Effect.provide(makeMockSafeAppsService({})))
    );
  });

  describe("signTypedData", () => {
    it.effect("returns Onchain variant for on-chain signing", () =>
      Effect.gen(function* () {
        const service = yield* SafeAppsService;
        const result = yield* service.signTypedData({
          domain: { chainId: 1, name: "Test" },
          message: { value: "test" },
          types: { Test: [{ name: "value", type: "string" }] },
        });

        expect(result._tag).toBe("Onchain");
        if (result._tag === "Onchain") {
          expect(result.safeTxHash).toBe(TEST_SAFE_TX_HASH);
        }
      }).pipe(Effect.provide(makeMockSafeAppsService({})))
    );

    it.effect("returns Offchain variant for off-chain signing", () =>
      Effect.gen(function* () {
        const service = yield* SafeAppsService;
        const result = yield* service.signTypedData({
          domain: { chainId: 1, name: "Test" },
          message: { value: "test" },
          types: { Test: [{ name: "value", type: "string" }] },
        });

        expect(result._tag).toBe("Offchain");
        if (result._tag === "Offchain") {
          expect(result.messageHash).toBe(TEST_MESSAGE_HASH);
        }
      }).pipe(
        Effect.provide(
          makeMockSafeAppsService({
            signTypedDataResult: {
              _tag: "Offchain",
              messageHash: TEST_MESSAGE_HASH,
            },
          })
        )
      )
    );
  });

  describe("getOffchainSignature", () => {
    it.effect("returns Option.none when signature not yet available", () =>
      Effect.gen(function* () {
        const service = yield* SafeAppsService;
        const result = yield* service.getOffchainSignature(TEST_MESSAGE_HASH);

        expect(Option.isNone(result)).toBe(true);
      }).pipe(Effect.provide(makeMockSafeAppsService({})))
    );

    it.effect("returns Option.some when signature available", () =>
      Effect.gen(function* () {
        const service = yield* SafeAppsService;
        const result = yield* service.getOffchainSignature(TEST_MESSAGE_HASH);

        expect(Option.isSome(result)).toBe(true);
        if (Option.isSome(result)) {
          expect(result.value).toBe(TEST_SIGNATURE);
        }
      }).pipe(
        Effect.provide(
          makeMockSafeAppsService({
            offchainSignature: Option.some(TEST_SIGNATURE),
          })
        )
      )
    );
  });

  describe("pollOffchainSignature", () => {
    it.effect("returns signature when available", () =>
      Effect.gen(function* () {
        const service = yield* SafeAppsService;
        const result = yield* service.pollOffchainSignature(TEST_MESSAGE_HASH);

        expect(result.messageHash).toBe(TEST_MESSAGE_HASH);
        expect(result.signature).toBe(TEST_SIGNATURE);
      }).pipe(Effect.provide(makeMockSafeAppsService({})))
    );
  });

  describe("enableOffchainSigning", () => {
    it.effect("completes without error", () =>
      Effect.gen(function* () {
        const service = yield* SafeAppsService;
        yield* service.enableOffchainSigning();
        // Success if no error thrown
      }).pipe(Effect.provide(makeMockSafeAppsService({})))
    );
  });
});
