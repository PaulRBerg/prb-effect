import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { Block, Hash } from "viem";
import type { GasService } from "@/src/gas/index.js";
import { GasServiceLive } from "@/src/gas/index.js";
import type { MockPublicClientConfig } from "@/src/testing-kit/index.js";
import { makeMockPublicClientLayer, TEST_CHAIN_ID } from "@/src/testing-kit/index.js";
import { deriveFeeOverrides, deriveTxType } from "./fees.js";

const DEFAULT_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hash;
const DEFAULT_BASE_FEE = 30_000_000_000n;
const DEFAULT_PRIORITY_FEE = 1_500_000_000n;
const DEFAULT_GAS_PRICE = 5_000_000_000n;

function makeBlock(baseFeePerGas: bigint | null): Block {
  return {
    baseFeePerGas,
    blobGasUsed: 0n,
    difficulty: 0n,
    excessBlobGas: 0n,
    extraData: "0x",
    gasLimit: 30_000_000n,
    gasUsed: 12_000_000n,
    hash: DEFAULT_HASH,
    logsBloom: "0x00",
    miner: "0x0000000000000000000000000000000000000000",
    mixHash: DEFAULT_HASH,
    nonce: "0x0000000000000000",
    number: 1000n,
    parentHash: DEFAULT_HASH,
    receiptsRoot: DEFAULT_HASH,
    sealFields: [],
    sha3Uncles: DEFAULT_HASH,
    size: 1024n,
    stateRoot: DEFAULT_HASH,
    timestamp: 1_700_000_000n,
    totalDifficulty: 0n,
    transactions: [],
    transactionsRoot: DEFAULT_HASH,
    uncles: [],
  };
}

function makeGasLayer(config: MockPublicClientConfig = {}): Layer.Layer<GasService> {
  return Layer.provide(GasServiceLive, makeMockPublicClientLayer(config));
}

function makeEip1559Layer(baseFee = DEFAULT_BASE_FEE): Layer.Layer<GasService> {
  return makeGasLayer({
    estimateMaxPriorityFeePerGas: () => Promise.resolve(DEFAULT_PRIORITY_FEE),
    getBlock: () => Promise.resolve(makeBlock(baseFee)),
  });
}

function makeLegacyLayer(gasPrice = DEFAULT_GAS_PRICE): Layer.Layer<GasService> {
  return makeGasLayer({
    getBlock: () => Promise.resolve(makeBlock(null)),
    getGasPrice: () => Promise.resolve(gasPrice),
  });
}

describe("deriveTxType", () => {
  it.effect("returns userOverrides.type when specified", () =>
    Effect.gen(function* () {
      const result = yield* deriveTxType({
        chainId: TEST_CHAIN_ID,
        userOverrides: { type: "legacy" },
      });
      expect(result).toBe("legacy");
    }).pipe(Effect.provide(makeEip1559Layer()))
  );

  it.effect("returns policy.txType when specified (no user override)", () =>
    Effect.gen(function* () {
      const result = yield* deriveTxType({
        chainId: TEST_CHAIN_ID,
        policy: { txType: "eip1559" },
      });
      expect(result).toBe("eip1559");
    }).pipe(Effect.provide(makeLegacyLayer()))
  );

  it.effect("returns legacy when userOverrides.gasPrice is set", () =>
    Effect.gen(function* () {
      const result = yield* deriveTxType({
        chainId: TEST_CHAIN_ID,
        userOverrides: { gasPrice: 1000n },
      });
      expect(result).toBe("legacy");
    }).pipe(Effect.provide(makeEip1559Layer()))
  );

  it.effect("returns eip1559 when chain supports it", () =>
    Effect.gen(function* () {
      const result = yield* deriveTxType({
        chainId: TEST_CHAIN_ID,
      });
      expect(result).toBe("eip1559");
    }).pipe(Effect.provide(makeEip1559Layer()))
  );

  it.effect("returns legacy when chain does not support EIP-1559", () =>
    Effect.gen(function* () {
      const result = yield* deriveTxType({
        chainId: TEST_CHAIN_ID,
      });
      expect(result).toBe("legacy");
    }).pipe(Effect.provide(makeLegacyLayer()))
  );

  it.effect("userOverrides.type takes precedence over policy.txType", () =>
    Effect.gen(function* () {
      const result = yield* deriveTxType({
        chainId: TEST_CHAIN_ID,
        policy: { txType: "eip1559" },
        userOverrides: { type: "legacy" },
      });
      expect(result).toBe("legacy");
    }).pipe(Effect.provide(makeEip1559Layer()))
  );
});

describe("deriveFeeOverrides", () => {
  it.effect("returns user gasPrice when provided", () =>
    Effect.gen(function* () {
      const result = yield* deriveFeeOverrides({
        chainId: TEST_CHAIN_ID,
        userOverrides: { gasPrice: 5000n },
      });
      expect(result).toEqual({ gasPrice: 5000n });
    }).pipe(Effect.provide(makeEip1559Layer()))
  );

  it.effect("returns user maxFeePerGas when provided", () =>
    Effect.gen(function* () {
      const result = yield* deriveFeeOverrides({
        chainId: TEST_CHAIN_ID,
        userOverrides: { maxFeePerGas: 10000n, maxPriorityFeePerGas: 1000n },
      });
      expect(result).toEqual({ maxFeePerGas: 10000n, maxPriorityFeePerGas: 1000n });
    }).pipe(Effect.provide(makeEip1559Layer()))
  );

  it.effect("estimates EIP-1559 fees for supported chains", () =>
    Effect.gen(function* () {
      const result = yield* deriveFeeOverrides({
        chainId: TEST_CHAIN_ID,
      });
      expect(result.maxFeePerGas).toBeDefined();
      expect(result.maxPriorityFeePerGas).toBeDefined();
    }).pipe(Effect.provide(makeEip1559Layer()))
  );

  it.effect("estimates legacy fees for unsupported chains", () =>
    Effect.gen(function* () {
      const result = yield* deriveFeeOverrides({
        chainId: TEST_CHAIN_ID,
      });
      expect(result.gasPrice).toBeDefined();
    }).pipe(Effect.provide(makeLegacyLayer()))
  );

  it.effect("caps fees with policy.maxFeePerGas", () =>
    Effect.gen(function* () {
      const result = yield* deriveFeeOverrides({
        chainId: TEST_CHAIN_ID,
        policy: { maxFeePerGas: 100n },
      });
      expect(result.maxFeePerGas).toBe(100n);
    }).pipe(Effect.provide(makeEip1559Layer()))
  );

  it.effect("caps priority fees with policy.maxPriorityFeePerGas", () =>
    Effect.gen(function* () {
      const result = yield* deriveFeeOverrides({
        chainId: TEST_CHAIN_ID,
        policy: { maxPriorityFeePerGas: 50n },
      });
      expect(result.maxPriorityFeePerGas).toBe(50n);
    }).pipe(Effect.provide(makeEip1559Layer()))
  );
});
