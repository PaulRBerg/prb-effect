import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import type { Abi } from "viem";
import { erc20Abi } from "viem";
import { ContractReader } from "@/src/contract/index.js";
import {
  ChainHead,
  ContractQuery,
  ContractQueryLive,
  MulticallBatcherLive,
  QueryClientLive,
} from "@/src/query/index.js";
import { makeRpcCacheLive, RequestDedupLive } from "@/src/rpc/index.js";
import { TEST_ADDRESS, TEST_ADDRESS_2, TEST_CHAIN_ID } from "@/src/testing-kit/index.js";

describe("ContractQuery", () => {
  it.effect("batches concurrent reads into a single multicall", () =>
    Effect.gen(function* () {
      let multicallCount = 0;
      let lastBatchSize = 0;

      const contractReaderLayer = Layer.succeed(
        ContractReader,
        ContractReader.of({
          multicall: (_chainId, calls) => {
            multicallCount += 1;
            lastBatchSize = calls.length;
            return Effect.succeed(
              calls.map((_, i) => ({
                result: BigInt(i + 1),
                status: "success" as const,
              })) as any
            );
          },
          read: () => Effect.succeed(0n as any),
        })
      );

      const chainHeadLayer = Layer.succeed(
        ChainHead,
        ChainHead.of({
          current: () => Effect.succeed(1n),
          watch: () => Effect.succeed(Stream.empty),
        })
      );

      const queryClientLayer = Layer.provideMerge(
        QueryClientLive,
        Layer.mergeAll(chainHeadLayer, makeRpcCacheLive({ ttl: 60_000 }), RequestDedupLive)
      );

      const multicallBatcherLayer = Layer.provideMerge(MulticallBatcherLive, contractReaderLayer);

      const contractQueryLayer = Layer.provide(
        ContractQueryLive,
        Layer.mergeAll(queryClientLayer, multicallBatcherLayer)
      );

      const contractQuery = yield* ContractQuery.pipe(Effect.provide(contractQueryLayer));

      // Use batching: true to enable request batching for concurrent effects
      const [r1, r2, r3] = yield* Effect.all(
        [
          contractQuery.read({
            abi: erc20Abi,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS] as const,
            chainId: TEST_CHAIN_ID,
            functionName: "balanceOf",
          }),
          contractQuery.read({
            abi: erc20Abi,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS_2] as const,
            chainId: TEST_CHAIN_ID,
            functionName: "balanceOf",
          }),
          contractQuery.read({
            abi: erc20Abi,
            address: TEST_ADDRESS,
            chainId: TEST_CHAIN_ID,
            functionName: "totalSupply",
          }),
        ],
        { batching: true, concurrency: 3 }
      );

      expect(r1).toBe(1n);
      expect(r2).toBe(2n);
      expect(r3).toBe(3n);
      expect(multicallCount).toBe(1);
      expect(lastBatchSize).toBe(3);
    }).pipe(Effect.scoped)
  );

  it.effect("caches identical reads (no additional multicall)", () =>
    Effect.gen(function* () {
      let multicallCount = 0;

      const contractReaderLayer = Layer.succeed(
        ContractReader,
        ContractReader.of({
          multicall: (_chainId, calls) => {
            multicallCount += 1;
            return Effect.succeed(
              calls.map(() => ({
                result: 123n,
                status: "success" as const,
              })) as any
            );
          },
          read: () => Effect.succeed(0n as any),
        })
      );

      const chainHeadLayer = Layer.succeed(
        ChainHead,
        ChainHead.of({
          current: () => Effect.succeed(1n),
          watch: () => Effect.succeed(Stream.empty),
        })
      );

      const queryClientLayer = Layer.provideMerge(
        QueryClientLive,
        Layer.mergeAll(chainHeadLayer, makeRpcCacheLive({ ttl: 60_000 }), RequestDedupLive)
      );

      const multicallBatcherLayer = Layer.provideMerge(MulticallBatcherLive, contractReaderLayer);

      const contractQueryLayer = Layer.provide(
        ContractQueryLive,
        Layer.mergeAll(queryClientLayer, multicallBatcherLayer)
      );

      const contractQuery = yield* ContractQuery.pipe(Effect.provide(contractQueryLayer));

      const params = {
        abi: erc20Abi,
        address: TEST_ADDRESS,
        args: [TEST_ADDRESS] as const,
        chainId: TEST_CHAIN_ID,
        functionName: "balanceOf" as const,
      };

      const r1 = yield* contractQuery.read(params);
      const r2 = yield* contractQuery.read(params);

      expect(r1).toBe(123n);
      expect(r2).toBe(123n);
      expect(multicallCount).toBe(1);
    }).pipe(Effect.scoped)
  );

  it.effect("does not crash when args contain BigInt (cache key)", () =>
    Effect.gen(function* () {
      let multicallCount = 0;

      const bigintArgAbi = [
        {
          inputs: [{ name: "x", type: "uint256" }],
          name: "echo",
          outputs: [{ name: "y", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
      ] as const satisfies Abi;

      const contractReaderLayer = Layer.succeed(
        ContractReader,
        ContractReader.of({
          multicall: (_chainId, calls) => {
            multicallCount += 1;
            expect(calls).toHaveLength(1);
            return Effect.succeed([{ result: 456n, status: "success" as const }] as any);
          },
          read: () => Effect.succeed(0n as any),
        })
      );

      const chainHeadLayer = Layer.succeed(
        ChainHead,
        ChainHead.of({
          current: () => Effect.succeed(1n),
          watch: () => Effect.succeed(Stream.empty),
        })
      );

      const queryClientLayer = Layer.provideMerge(
        QueryClientLive,
        Layer.mergeAll(chainHeadLayer, makeRpcCacheLive({ ttl: 60_000 }), RequestDedupLive)
      );

      const multicallBatcherLayer = Layer.provideMerge(MulticallBatcherLive, contractReaderLayer);

      const contractQueryLayer = Layer.provide(
        ContractQueryLive,
        Layer.mergeAll(queryClientLayer, multicallBatcherLayer)
      );

      const contractQuery = yield* ContractQuery.pipe(Effect.provide(contractQueryLayer));

      const params = {
        abi: bigintArgAbi,
        address: TEST_ADDRESS,
        args: [1n] as const,
        chainId: TEST_CHAIN_ID,
        functionName: "echo" as const,
      };

      const r1 = yield* contractQuery.read(params);
      const r2 = yield* contractQuery.read(params);

      expect(r1).toBe(456n);
      expect(r2).toBe(456n);
      expect(multicallCount).toBe(1);
    }).pipe(Effect.scoped)
  );
});
