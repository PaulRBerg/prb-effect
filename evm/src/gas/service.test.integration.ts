import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import type { Address, Block } from "viem";
import { base, mainnet } from "viem/chains";
import { MIN_TX_GAS } from "#src/constants/index.js";
import { ClientNotFoundError } from "#src/core/index.js";
import { GasPriceUnavailableError, GasService } from "#src/gas/index.js";
import { makeEffectEvmTestLayer } from "#src/testing-kit/index.js";

const DEFAULT_BLOCK: Block = {
  baseFeePerGas: 30000000000n,
  blobGasUsed: 0n,
  difficulty: 0n,
  excessBlobGas: 0n,
  extraData: "0x",
  gasLimit: 30000000n,
  gasUsed: 12000000n,
  hash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  logsBloom: "0x00",
  miner: "0x0000000000000000000000000000000000000000",
  mixHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  nonce: "0x0000000000000000",
  number: 1000n,
  parentHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  receiptsRoot: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  sealFields: [],
  sha3Uncles: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  size: 1024n,
  stateRoot: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  timestamp: 1700000000n,
  totalDifficulty: 0n,
  transactions: [],
  transactionsRoot: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  uncles: [],
};

describe("GasService (Live)", () => {
  const eip1559Layer = makeEffectEvmTestLayer({
    publicClient: {
      estimateGas: async () => MIN_TX_GAS,
      estimateMaxPriorityFeePerGas: async () => 1500000000n, // 1.5 gwei baseline
      getBlock: async () => DEFAULT_BLOCK,
      getGasPrice: async () => 45000000000n,
    },
  });
  const pendingBaseFeeMissingLayer = makeEffectEvmTestLayer({
    publicClient: {
      estimateGas: async () => MIN_TX_GAS,
      estimateMaxPriorityFeePerGas: async () => 1500000000n, // 1.5 gwei baseline
      getBlock: (params: unknown) => {
        const p = params as { blockTag?: "latest" | "pending" } | undefined;
        if (p?.blockTag === "pending") {
          return Promise.resolve({ ...DEFAULT_BLOCK, baseFeePerGas: null });
        }
        return Promise.resolve(DEFAULT_BLOCK);
      },
      getGasPrice: async () => 45000000000n,
    },
  });
  const opStackLayer = makeEffectEvmTestLayer({
    chainId: base.id,
    publicClient: {
      chain: base,
      estimateL1Fee: async () => 987654321n,
    },
  });

  describe("EIP-1559 estimation", () => {
    it.effect("uses estimateMaxPriorityFeePerGas as baseline", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const estimates = yield* service.getAllFeeEstimates({
          chainId: mainnet.id,
        });

        expect(estimates.slow.maxPriorityFeePerGas).toBe(2500000000n);
        expect(estimates.standard.maxPriorityFeePerGas).toBe(3000000000n);
        expect(estimates.fast.maxPriorityFeePerGas).toBe(4000000000n);
        expect(estimates.instant.maxPriorityFeePerGas).toBe(6500000000n);

        expect(estimates.instant.maxPriorityFeePerGas).toBeGreaterThan(
          estimates.fast.maxPriorityFeePerGas
        );
        expect(estimates.fast.maxPriorityFeePerGas).toBeGreaterThan(
          estimates.standard.maxPriorityFeePerGas
        );
        expect(estimates.standard.maxPriorityFeePerGas).toBeGreaterThan(
          estimates.slow.maxPriorityFeePerGas
        );
      }).pipe(Effect.provide(eip1559Layer))
    );

    it.effect("supportsEip1559 returns true", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const supports = yield* service.supportsEip1559({
          chainId: mainnet.id,
        });
        expect(supports).toBe(true);
      }).pipe(Effect.provide(eip1559Layer))
    );

    it.effect("falls back to latest base fee when pending is missing", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const estimates = yield* service.getAllFeeEstimates({
          chainId: mainnet.id,
        });

        const expectedPriority = 1500000000n + 1500000000n;
        const baseFee = 30000000000n; // DEFAULT_BLOCK.baseFeePerGas
        expect(estimates.standard.estimatedBaseFee).toBe(baseFee);
        expect(estimates.standard.maxFeePerGas).toBe(baseFee * 2n + expectedPriority);
      }).pipe(Effect.provide(pendingBaseFeeMissingLayer))
    );
  });

  describe("Legacy estimation", () => {
    const legacyLayer = makeEffectEvmTestLayer({
      publicClient: {
        getBlock: async () => ({ ...DEFAULT_BLOCK, baseFeePerGas: null }),
        getGasPrice: async () => 1000n,
      },
    });

    it.effect("falls back to gasPrice multipliers", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const estimates = yield* service.getAllFeeEstimates({
          chainId: mainnet.id,
        });

        expect(estimates.standard.gasPrice).toBe(1000n);
        expect(estimates.slow.gasPrice).toBe(900n);
        expect(estimates.fast.gasPrice).toBe(1250n);
        expect(estimates.instant.gasPrice).toBe(1500n);
        expect(estimates.standard.maxPriorityFeePerGas).toBe(0n);
      }).pipe(Effect.provide(legacyLayer))
    );

    it.effect("supportsEip1559 returns false", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const supports = yield* service.supportsEip1559({
          chainId: mainnet.id,
        });
        expect(supports).toBe(false);
      }).pipe(Effect.provide(legacyLayer))
    );

    it.effect("getBaseFee fails with GasPriceUnavailableError", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const exit = yield* service.getBaseFee({ chainId: mainnet.id }).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(GasPriceUnavailableError);
          }
        }
      }).pipe(Effect.provide(legacyLayer))
    );
  });

  describe("estimateGas", () => {
    it.effect("returns gas estimate", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const gas = yield* service.estimateGas({
          chainId: mainnet.id,
          to: "0x1234567890123456789012345678901234567890" as Address,
        });

        expect(gas).toBe(MIN_TX_GAS);
      }).pipe(Effect.provide(eip1559Layer))
    );
  });

  describe("OP Stack L1 fee estimation", () => {
    it.effect("hasL1DataFee returns true for OP Stack chains", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const hasL1DataFee = yield* service.hasL1DataFee({
          chainId: base.id,
        });

        expect(hasL1DataFee).toBe(true);
      }).pipe(Effect.provide(opStackLayer))
    );

    it.effect("estimateL1Fee returns the mocked L1 data fee", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const l1Fee = yield* service.estimateL1Fee({
          chainId: base.id,
          to: "0x1234567890123456789012345678901234567890" as Address,
        });

        expect(l1Fee).toBe(987654321n);
      }).pipe(Effect.provide(opStackLayer))
    );
  });

  describe("unsupported chainId", () => {
    it.effect("fails with ClientNotFoundError", () =>
      Effect.gen(function* () {
        const service = yield* GasService;
        const exit = yield* service.getAllFeeEstimates({ chainId: 999 }).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(ClientNotFoundError);
          }
        }
      }).pipe(Effect.provide(eip1559Layer))
    );
  });
});
