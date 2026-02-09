import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, TestClock } from "effect";
import type { Block, Hash } from "viem";
import { mainnet } from "viem/chains";
import { BlockNotFoundError, BlockService, BlockTimeoutError } from "#src/block/index.js";
import { ClientNotFoundError, TransportError } from "#src/core/index.js";
import { makeEffectEvmTestLayer } from "#src/testing-kit/index.js";

const DEFAULT_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hash;

const DEFAULT_BLOCK: Block = {
  baseFeePerGas: 30000000000n,
  blobGasUsed: 0n,
  difficulty: 0n,
  excessBlobGas: 0n,
  extraData: "0x",
  gasLimit: 30000000n,
  gasUsed: 12000000n,
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
  timestamp: 1700000000n,
  totalDifficulty: 0n,
  transactions: [],
  transactionsRoot: DEFAULT_HASH,
  uncles: [],
};

describe("BlockService (Live)", () => {
  const testLayer = makeEffectEvmTestLayer({
    publicClient: {
      getBlock: (params: unknown) => {
        const p = params as { blockNumber?: bigint; blockHash?: Hash };
        return Promise.resolve({
          ...DEFAULT_BLOCK,
          hash: p.blockHash ?? DEFAULT_BLOCK.hash,
          number: p.blockNumber ?? DEFAULT_BLOCK.number,
        });
      },
      getBlockNumber: () => Promise.resolve(1000n),
    },
  });

  describe("getBlockNumber", () => {
    it.effect("returns current block number", () =>
      Effect.gen(function* () {
        const service = yield* BlockService;
        const result = yield* service.getBlockNumber({ chainId: mainnet.id });

        expect(result).toBe(1000n);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("fails with ClientNotFoundError for unsupported chainId", () =>
      Effect.gen(function* () {
        const service = yield* BlockService;
        const exit = yield* Effect.exit(service.getBlockNumber({ chainId: 999 }));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(ClientNotFoundError);
          }
        }
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("fails with TransportError (not timeout) on RPC error", () => {
      const failingLayer = makeEffectEvmTestLayer({
        publicClient: {
          getBlockNumber: () => Promise.reject(new Error("boom")),
        },
      });

      return Effect.gen(function* () {
        const service = yield* BlockService;
        const exit = yield* service.getBlockNumber({ chainId: mainnet.id }).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(TransportError);
          }
        }
      }).pipe(Effect.provide(failingLayer));
    });
  });

  describe("getBlock / getBlockByHash / getBlocks", () => {
    it.effect("returns block by number", () =>
      Effect.gen(function* () {
        const service = yield* BlockService;
        const result = yield* service.getBlock({
          blockNumber: 123n,
          chainId: mainnet.id,
        });

        expect(result.number).toBe(123n);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns block by tag", () =>
      Effect.gen(function* () {
        const service = yield* BlockService;
        const result = yield* service.getBlock({
          blockTag: "latest",
          chainId: mainnet.id,
        });

        expect(result.hash).toBeDefined();
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns block by hash", () =>
      Effect.gen(function* () {
        const service = yield* BlockService;
        const result = yield* service.getBlockByHash({
          chainId: mainnet.id,
          hash: DEFAULT_HASH,
        });

        expect(result.hash).toBe(DEFAULT_HASH);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns range of blocks", () =>
      Effect.gen(function* () {
        const service = yield* BlockService;
        const result = yield* service.getBlocks({
          chainId: mainnet.id,
          fromBlock: 10n,
          toBlock: 12n,
        });

        expect(result.map((b) => b.number)).toEqual([10n, 11n, 12n]);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("waitForBlock", () => {
    it.effect("times out with BlockTimeoutError (not misclassified)", () => {
      const current = 0n;
      const layer = makeEffectEvmTestLayer({
        publicClient: {
          getBlockNumber: () => Promise.resolve(current),
        },
      });

      return Effect.gen(function* () {
        const service = yield* BlockService;
        const fiber = yield* Effect.fork(
          service.waitForBlock({
            blockNumber: 10n,
            chainId: mainnet.id,
            timeout: 2500,
          })
        );

        yield* TestClock.adjust("3 seconds");

        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(BlockTimeoutError);
          }
        }
      }).pipe(Effect.provide(layer));
    });

    it.effect("is interruptible", () => {
      const current = 0n;
      const layer = makeEffectEvmTestLayer({
        publicClient: {
          getBlockNumber: () => Promise.resolve(current),
        },
      });

      return Effect.gen(function* () {
        const service = yield* BlockService;
        const fiber = yield* Effect.fork(
          service.waitForBlock({
            blockNumber: 10n,
            chainId: mainnet.id,
            timeout: 60_000,
          })
        );

        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isInterrupted(exit)).toBe(true);
      }).pipe(Effect.provide(layer));
    });

    it.effect("returns BlockNotFoundError when block fetch fails", () => {
      const layer = makeEffectEvmTestLayer({
        publicClient: {
          getBlock: () => Promise.reject(new Error("missing")),
          getBlockNumber: () => Promise.resolve(10n),
        },
      });

      return Effect.gen(function* () {
        const service = yield* BlockService;
        const exit = yield* service
          .waitForBlock({ blockNumber: 10n, chainId: mainnet.id })
          .pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(BlockNotFoundError);
          }
        }
      }).pipe(Effect.provide(layer));
    });
  });
});
