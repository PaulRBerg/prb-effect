import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result } from "effect";
import type { Address } from "viem";
import { erc20Abi } from "viem";
import { ContractReaderLive } from "#src/contract/index.js";
import { PublicClientService } from "#src/core/index.js";
import { MulticallBatcher, MulticallBatcherLive } from "#src/query/index.js";
import {
  makeMockPublicClientLayer,
  TEST_ADDRESS,
  TEST_ADDRESS_2,
  TEST_CHAIN_ID,
} from "#src/testing-kit/index.js";

describe("MulticallBatcher accounts", () => {
  it.effect("groups reads by chain and block options", () => {
    const chains: number[] = [];
    const batches: unknown[] = [];
    const clients = Layer.provide(
      Layer.effect(
        PublicClientService,
        Effect.gen(function* () {
          const base = yield* PublicClientService;
          return PublicClientService.of({
            get: (chainId) => {
              chains.push(chainId);
              return base.get(TEST_CHAIN_ID);
            },
          });
        })
      ),
      makeMockPublicClientLayer({
        multicall: (params) => {
          const request = params as {
            contracts: readonly unknown[];
            blockNumber?: bigint;
            blockTag?: string;
          };
          batches.push({
            blockNumber: request.blockNumber,
            blockTag: request.blockTag,
            size: request.contracts.length,
          });
          return Promise.resolve(
            request.contracts.map(() => ({ result: 1n, status: "success" as const }))
          );
        },
      })
    );
    const layer = Layer.provide(MulticallBatcherLive, Layer.provide(ContractReaderLive, clients));
    return Effect.gen(function* () {
      const batcher = yield* MulticallBatcher;
      const call = { abi: erc20Abi, address: TEST_ADDRESS, functionName: "totalSupply" } as const;
      const values = yield* Effect.all(
        [
          batcher.enqueue(TEST_CHAIN_ID, call, { blockNumber: 12n }),
          batcher.enqueue(TEST_CHAIN_ID, call, { blockNumber: 12n }),
          batcher.enqueue(TEST_CHAIN_ID, call, { blockNumber: 13n }),
          batcher.enqueue(2, call, { blockNumber: 12n }),
          batcher.enqueue(TEST_CHAIN_ID, call, { blockTag: "latest" }),
        ],
        { batching: true, concurrency: "unbounded" }
      );
      expect(values).toEqual([1n, 1n, 1n, 1n, 1n]);
      expect(chains.toSorted()).toEqual([1, 1, 1, 2]);
      expect(batches).toEqual(
        expect.arrayContaining([
          { blockNumber: 12n, blockTag: undefined, size: 2 },
          { blockNumber: 13n, blockTag: undefined, size: 1 },
          { blockNumber: 12n, blockTag: undefined, size: 1 },
          { blockNumber: undefined, blockTag: "latest", size: 1 },
        ])
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("caps multicalls at 100 entries without losing results", () => {
    const sizes: number[] = [];
    const layer = Layer.provide(
      MulticallBatcherLive,
      Layer.provide(
        ContractReaderLive,
        makeMockPublicClientLayer({
          multicall: (params) => {
            const { contracts } = params as { contracts: readonly { address: Address }[] };
            sizes.push(contracts.length);
            return Promise.resolve(
              contracts.map(({ address }) => ({
                result: BigInt(address),
                status: "success" as const,
              }))
            );
          },
        })
      )
    );
    return Effect.gen(function* () {
      const batcher = yield* MulticallBatcher;
      const values = yield* Effect.all(
        Array.from({ length: 205 }, (_, i) =>
          batcher.enqueue(TEST_CHAIN_ID, {
            abi: erc20Abi,
            address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
            functionName: "totalSupply",
          })
        ),
        { batching: true, concurrency: "unbounded" }
      );
      expect(values).toEqual(Array.from({ length: 205 }, (_, i) => BigInt(i + 1)));
      expect(sizes.toSorted((a, b) => a - b)).toEqual([5, 100, 100]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps per-call failures independent of successful entries", () => {
    const layer = Layer.provide(
      MulticallBatcherLive,
      Layer.provide(
        ContractReaderLive,
        makeMockPublicClientLayer({
          multicall: async () => [
            { result: 1n, status: "success" },
            { error: new Error("second call failed"), status: "failure" },
            { result: 3n, status: "success" },
          ],
        })
      )
    );
    return Effect.gen(function* () {
      const batcher = yield* MulticallBatcher;
      const results = yield* Effect.all(
        [TEST_ADDRESS, TEST_ADDRESS_2, "0x0000000000000000000000000000000000000001"].map(
          (address) =>
            batcher
              .enqueue(TEST_CHAIN_ID, {
                abi: erc20Abi,
                address: address as Address,
                functionName: "totalSupply",
              })
              .pipe(Effect.result)
        ),
        { batching: true, concurrency: "unbounded" }
      );
      expect(results[0]).toEqual(Result.succeed(1n));
      const failed = results[1];
      expect(failed && Result.isFailure(failed) && failed.failure.message).toContain(
        "second call failed"
      );
      expect(results[2]).toEqual(Result.succeed(3n));
    }).pipe(Effect.provide(layer));
  });

  it.effect("reads account-specific calls directly while preserving ordinary multicalls", () => {
    const accounts: unknown[] = [];
    let multicalls = 0;
    const layer = Layer.provide(
      MulticallBatcherLive,
      Layer.provide(
        ContractReaderLive,
        makeMockPublicClientLayer({
          multicall: () => {
            multicalls += 1;
            return Promise.resolve([{ result: 20n, status: "success" }]);
          },
          readContract: (params: unknown) => {
            const request = params as { account?: string; blockNumber?: bigint };
            accounts.push(request.account);
            expect(request.blockNumber).toBe(12n);
            return Promise.resolve(10n);
          },
        })
      )
    );
    return Effect.gen(function* () {
      const batcher = yield* MulticallBatcher;
      const call = { abi: erc20Abi, address: TEST_ADDRESS, functionName: "totalSupply" } as const;
      const values = yield* Effect.all(
        [
          batcher.enqueue(TEST_CHAIN_ID, call, { account: TEST_ADDRESS, blockNumber: 12n }),
          batcher.enqueue(TEST_CHAIN_ID, call, { account: TEST_ADDRESS_2, blockNumber: 12n }),
          batcher.enqueue(TEST_CHAIN_ID, call),
        ],
        { batching: true, concurrency: 3 }
      );
      expect(values).toEqual([10n, 10n, 20n]);
      expect(accounts).toEqual([TEST_ADDRESS, TEST_ADDRESS_2]);
      expect(multicalls).toBe(1);
    }).pipe(Effect.provide(layer));
  });
});
