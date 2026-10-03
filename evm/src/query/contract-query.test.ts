import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { erc20Abi } from "viem";
import {
  ChainHead,
  ContractQuery,
  ContractQueryLive,
  MulticallBatcher,
  QueryClientLive,
} from "#src/query/index.js";
import { makeRpcCacheLive, RequestDedupLive, RpcCache } from "#src/rpc/index.js";
import { TEST_ADDRESS, TEST_CHAIN_ID } from "#src/testing-kit/index.js";

describe("ContractQuery.watchRead", () => {
  it.live("emits cold-cache and refetched results without recursively deduplicating itself", () => {
    let reads = 0;
    const queryLayer = Layer.provideMerge(
      QueryClientLive,
      Layer.mergeAll(
        Layer.succeed(ChainHead, {
          current: () => Effect.succeed(1n),
          watch: () => Effect.succeed(Stream.empty),
        }),
        makeRpcCacheLive(),
        RequestDedupLive
      )
    );
    const layer = Layer.provideMerge(
      ContractQueryLive,
      Layer.mergeAll(
        queryLayer,
        Layer.succeed(MulticallBatcher, {
          enqueue: <A>() => Effect.sync(() => BigInt(++reads) as A),
        })
      )
    );

    return Effect.gen(function* () {
      const query = yield* ContractQuery;
      const cache = yield* RpcCache;
      const stream = yield* query.watchRead(
        {
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          functionName: "totalSupply",
        },
        { refetchOn: Stream.fromEffect(cache.clear) }
      );
      const results = yield* Stream.runCollect(stream).pipe(Effect.timeout("200 millis"));
      expect(Array.from(results)).toEqual([1n, 2n]);
      expect(reads).toBe(2);
    }).pipe(Effect.provide(layer));
  });
});
