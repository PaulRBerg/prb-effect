import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import type { Address, Block, Hash, Hex } from "viem";
import { base } from "viem/chains";
import { GasService, GasServiceLive } from "#src/gas/index.js";
import type { MockPublicClientConfig } from "#src/testing-kit/index.js";
import {
  makeMockPublicClientLayer,
  TEST_CHAIN_ID,
  UNKNOWN_CHAIN_ID,
} from "#src/testing-kit/index.js";

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

function makeOpStackLayer(
  config: MockPublicClientConfig = {},
  chainId = base.id
): Layer.Layer<GasService> {
  return Layer.provide(
    GasServiceLive,
    makeMockPublicClientLayer(
      {
        chain: base,
        ...config,
      },
      chainId
    )
  );
}

describe("GasService", () => {
  describe("hasL1DataFee", () => {
    it.effect("returns true for OP Stack chains", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const result = yield* gasService.hasL1DataFee({ chainId: base.id });
        expect(result).toBe(true);
      }).pipe(Effect.provide(makeOpStackLayer()))
    );

    it.effect("returns false for non-OP Stack chains", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const result = yield* gasService.hasL1DataFee({ chainId: TEST_CHAIN_ID });
        expect(result).toBe(false);
      }).pipe(Effect.provide(makeGasLayer()))
    );
  });

  describe("supportsEip1559", () => {
    it.effect("returns true when baseFeePerGas is present", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const result = yield* gasService.supportsEip1559({ chainId: TEST_CHAIN_ID });
        expect(result).toBe(true);
      }).pipe(Effect.provide(makeEip1559Layer()))
    );

    it.effect("returns false when baseFeePerGas is null", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const result = yield* gasService.supportsEip1559({ chainId: TEST_CHAIN_ID });
        expect(result).toBe(false);
      }).pipe(Effect.provide(makeLegacyLayer()))
    );

    it.effect("returns ClientNotFoundError for unknown chainId", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const exit = yield* gasService
          .supportsEip1559({ chainId: UNKNOWN_CHAIN_ID })
          .pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(Effect.provide(makeGasLayer()))
    );
  });

  describe("getAllFeeEstimates", () => {
    it.effect("returns EIP-1559 estimates when chain supports it", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const estimates = yield* gasService.getAllFeeEstimates({ chainId: TEST_CHAIN_ID });

        expect(estimates.slow).toBeDefined();
        expect(estimates.standard).toBeDefined();
        expect(estimates.fast).toBeDefined();
        expect(estimates.instant).toBeDefined();

        expect(estimates.standard.estimatedBaseFee).toBeGreaterThan(0n);
        expect(estimates.standard.maxPriorityFeePerGas).toBeGreaterThan(0n);
        expect(estimates.standard.maxFeePerGas).toBeGreaterThan(0n);
      }).pipe(Effect.provide(makeEip1559Layer()))
    );

    it.effect("falls back to latest block when pending block fails (L2 chains)", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const estimates = yield* gasService.getAllFeeEstimates({ chainId: TEST_CHAIN_ID });
        expect(estimates.standard.estimatedBaseFee).toBe(25_000_000_000n);
      }).pipe(
        Effect.provide(
          makeGasLayer({
            estimateMaxPriorityFeePerGas: () => Promise.resolve(DEFAULT_PRIORITY_FEE),
            getBlock: (params: unknown) => {
              const { blockTag } = params as { blockTag: string };
              if (blockTag === "pending") {
                return Promise.reject(new Error("Pending block not supported"));
              }
              return Promise.resolve(makeBlock(25_000_000_000n));
            },
          })
        )
      )
    );

    it.effect("uses base fee from latest block when pending block has no base fee", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const estimates = yield* gasService.getAllFeeEstimates({ chainId: TEST_CHAIN_ID });
        expect(estimates.standard.estimatedBaseFee).toBe(20_000_000_000n);
      }).pipe(
        Effect.provide(
          makeGasLayer({
            estimateMaxPriorityFeePerGas: () => Promise.resolve(DEFAULT_PRIORITY_FEE),
            getBlock: (params: unknown) => {
              const { blockTag } = params as { blockTag: string };
              if (blockTag === "pending") {
                return Promise.resolve(makeBlock(null));
              }
              return Promise.resolve(makeBlock(20_000_000_000n));
            },
          })
        )
      )
    );

    it.effect(
      "falls back to legacy estimation when base fee missing in both blocks (BNB Chain)",
      () =>
        Effect.gen(function* () {
          const gasService = yield* GasService;
          const estimates = yield* gasService.getAllFeeEstimates({ chainId: TEST_CHAIN_ID });

          expect(estimates.standard.estimatedBaseFee).toBe(0n);
          expect(estimates.standard.gasPrice).toBeDefined();
          expect(estimates.standard.maxPriorityFeePerGas).toBe(0n);
        }).pipe(
          Effect.provide(
            makeGasLayer({
              estimateMaxPriorityFeePerGas: () => Promise.resolve(DEFAULT_PRIORITY_FEE),
              getBlock: () => Promise.resolve(makeBlock(null)),
              getGasPrice: () => Promise.resolve(DEFAULT_GAS_PRICE),
            })
          )
        )
    );

    it.effect("falls back to legacy estimation when estimateMaxPriorityFeePerGas fails", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const estimates = yield* gasService.getAllFeeEstimates({ chainId: TEST_CHAIN_ID });

        // Should fall back to legacy estimation
        expect(estimates.standard.estimatedBaseFee).toBe(0n);
        expect(estimates.standard.gasPrice).toBeDefined();
        expect(estimates.standard.maxPriorityFeePerGas).toBe(0n);
      }).pipe(
        Effect.provide(
          makeGasLayer({
            // But estimateMaxPriorityFeePerGas fails
            estimateMaxPriorityFeePerGas: () => Promise.reject(new Error("Method not supported")),
            // Chain reports EIP-1559 support (has baseFee)
            getBlock: () => Promise.resolve(makeBlock(DEFAULT_BASE_FEE)),
            // Falls back to legacy
            getGasPrice: () => Promise.resolve(DEFAULT_GAS_PRICE),
          })
        )
      )
    );

    it.effect("returns legacy estimates for non-EIP-1559 chains", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const estimates = yield* gasService.getAllFeeEstimates({ chainId: TEST_CHAIN_ID });

        expect(estimates.standard.estimatedBaseFee).toBe(0n);
        expect(estimates.standard.gasPrice).toBe(DEFAULT_GAS_PRICE);
        expect(estimates.standard.maxPriorityFeePerGas).toBe(0n);

        // Speed tiers apply multipliers to gas price
        expect(estimates.slow.gasPrice).toBe(4_500_000_000n); // 0.9x
        expect(estimates.fast.gasPrice).toBe(6_250_000_000n); // 1.25x
        expect(estimates.instant.gasPrice).toBe(7_500_000_000n); // 1.5x
      }).pipe(Effect.provide(makeLegacyLayer()))
    );

    it.effect("returns GasPriceUnavailableError when getGasPrice fails on legacy chain", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const exit = yield* gasService
          .getAllFeeEstimates({ chainId: TEST_CHAIN_ID })
          .pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
          expect(exit.cause.error._tag).toBe("GasPriceUnavailableError");
        }
      }).pipe(
        Effect.provide(
          makeGasLayer({
            getBlock: () => Promise.resolve(makeBlock(null)),
            getGasPrice: () => Promise.reject(new Error("RPC error")),
          })
        )
      )
    );

    it.effect("returns GasPriceUnavailableError when both pending and latest block fail", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const exit = yield* gasService
          .getAllFeeEstimates({ chainId: TEST_CHAIN_ID })
          .pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          makeGasLayer({
            getBlock: (() => {
              let latestCallCount = 0;
              return (params: unknown) => {
                const { blockTag } = params as { blockTag: string };
                if (blockTag === "latest") {
                  latestCallCount++;
                  if (latestCallCount === 1) {
                    return Promise.resolve(makeBlock(DEFAULT_BASE_FEE));
                  }
                  return Promise.reject(new Error("RPC error on latest"));
                }
                return Promise.reject(new Error("Pending not supported"));
              };
            })(),
            estimateMaxPriorityFeePerGas: () => Promise.resolve(DEFAULT_PRIORITY_FEE),
          })
        )
      )
    );
  });

  describe("estimateL1Fee", () => {
    const TO = "0x1234567890123456789012345678901234567890" as Address;
    const FROM = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
    const DATA = "0x1234" as Hex;

    it.effect("uses the mock public client default L1 fee stub when not overridden", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const result = yield* gasService.estimateL1Fee({
          chainId: base.id,
          to: TO,
        });

        expect(result).toBe(0n);
      }).pipe(Effect.provide(makeOpStackLayer()))
    );

    it.effect("returns the L1 data fee for OP Stack chains", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const result = yield* gasService.estimateL1Fee({
          chainId: base.id,
          data: DATA,
          from: FROM,
          to: TO,
          value: 1n,
        });

        expect(result).toBe(123456789n);
      }).pipe(
        Effect.provide(
          makeOpStackLayer({
            estimateL1Fee: (params: unknown) => {
              expect(params).toMatchObject({
                account: FROM,
                data: DATA,
                to: TO,
                value: 1n,
              });
              return Promise.resolve(123456789n);
            },
          })
        )
      )
    );

    it.effect("returns 0n for non-OP Stack chains without calling the L1 estimator", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const result = yield* gasService.estimateL1Fee({
          chainId: TEST_CHAIN_ID,
          to: TO,
        });

        expect(result).toBe(0n);
      }).pipe(
        Effect.provide(
          makeGasLayer({
            estimateL1Fee: () => Promise.reject(new Error("should not be called")),
          })
        )
      )
    );

    it.effect("returns GasPriceUnavailableError when L1 fee estimation fails", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const exit = yield* gasService
          .estimateL1Fee({
            chainId: base.id,
            to: TO,
          })
          .pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
          expect(exit.cause.error._tag).toBe("GasPriceUnavailableError");
          expect(exit.cause.error.message).toContain("Failed to estimate L1 data fee");
        }
      }).pipe(
        Effect.provide(
          makeOpStackLayer({
            estimateL1Fee: () => Promise.reject(new Error("RPC error")),
          })
        )
      )
    );
  });

  describe("estimateFees", () => {
    it.effect("returns estimate for specified speed", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const estimate = yield* gasService.estimateFees({ chainId: TEST_CHAIN_ID, speed: "fast" });
        expect(estimate.confidence).toBe(95);
      }).pipe(Effect.provide(makeEip1559Layer()))
    );

    it.effect("defaults to standard speed when not specified", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const estimate = yield* gasService.estimateFees({ chainId: TEST_CHAIN_ID });
        expect(estimate.confidence).toBe(85);
      }).pipe(Effect.provide(makeEip1559Layer()))
    );
  });

  describe("getBaseFee", () => {
    it.effect("returns base fee from pending block", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const baseFee = yield* gasService.getBaseFee({ chainId: TEST_CHAIN_ID });
        expect(baseFee).toBe(DEFAULT_BASE_FEE);
      }).pipe(Effect.provide(makeEip1559Layer()))
    );

    it.effect("falls back to latest block when pending has no base fee", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const baseFee = yield* gasService.getBaseFee({ chainId: TEST_CHAIN_ID });
        expect(baseFee).toBe(25_000_000_000n);
      }).pipe(
        Effect.provide(
          makeGasLayer({
            getBlock: (params: unknown) => {
              const { blockTag } = params as { blockTag: string };
              if (blockTag === "pending") {
                return Promise.resolve(makeBlock(null));
              }
              return Promise.resolve(makeBlock(25_000_000_000n));
            },
          })
        )
      )
    );

    it.effect("returns error when base fee unavailable in both blocks", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const exit = yield* gasService.getBaseFee({ chainId: TEST_CHAIN_ID }).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
          expect(exit.cause.error._tag).toBe("GasPriceUnavailableError");
          expect(exit.cause.error.message).toContain("not support EIP-1559");
        }
      }).pipe(Effect.provide(makeLegacyLayer()))
    );
  });

  describe("getMaxPriorityFee", () => {
    it.effect("returns max priority fee", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const fee = yield* gasService.getMaxPriorityFee({ chainId: TEST_CHAIN_ID });
        expect(fee).toBe(DEFAULT_PRIORITY_FEE);
      }).pipe(Effect.provide(makeEip1559Layer()))
    );

    it.effect("returns error when estimation fails", () =>
      Effect.gen(function* () {
        const gasService = yield* GasService;
        const exit = yield* gasService
          .getMaxPriorityFee({ chainId: TEST_CHAIN_ID })
          .pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          makeGasLayer({
            estimateMaxPriorityFeePerGas: () => Promise.reject(new Error("RPC error")),
          })
        )
      )
    );
  });
});
