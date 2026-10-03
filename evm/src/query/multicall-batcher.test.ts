import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { erc20Abi } from "viem";
import { ContractReaderLive } from "#src/contract/index.js";
import { MulticallBatcher, MulticallBatcherLive } from "#src/query/index.js";
import {
  makeMockPublicClientLayer,
  TEST_ADDRESS,
  TEST_ADDRESS_2,
  TEST_CHAIN_ID,
} from "#src/testing-kit/index.js";

describe("MulticallBatcher accounts", () => {
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
