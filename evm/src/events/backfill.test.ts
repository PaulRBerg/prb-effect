import { describe, expect, it } from "@effect/vitest";
import { Chunk, Effect, Layer, Stream } from "effect";
import { erc20Abi } from "viem";
import { EventBackfillError } from "#src/core/index.js";
import { EventBackfill, EventBackfillLive } from "#src/events/index.js";
import { makeMockPublicClientLayer, TEST_ADDRESS, TEST_CHAIN_ID } from "#src/testing-kit/index.js";

// A single Transfer log fixture decoded by the backfill pipeline.
const transferLog = {
  address: TEST_ADDRESS,
  blockHash: "0xblockhash",
  blockNumber: 5n,
  data: "0x0000000000000000000000000000000000000000000000000000000000000064",
  logIndex: 0,
  removed: false,
  transactionHash: "0xtxhash",
  transactionIndex: 0,
  topics: [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x0000000000000000000000001234567890123456789012345678901234567890",
    "0x0000000000000000000000000987654321098765432109876543210987654321",
  ],
};

describe("EventBackfill (retry + typed errors)", () => {
  it.live("retries a transient getLogs rejection then delivers all events", () => {
    let calls = 0;
    const layer = Layer.provide(
      EventBackfillLive,
      makeMockPublicClientLayer({
        getLogs: () => {
          calls += 1;
          // First attempt rejects with a retryable RPC error, then succeeds.
          if (calls === 1) {
            return Promise.reject(new Error("rate limit exceeded"));
          }
          return Promise.resolve([transferLog]);
        },
      })
    );

    return Effect.gen(function* () {
      const backfill = yield* EventBackfill;
      const stream = yield* backfill.fetch({
        abi: erc20Abi,
        address: TEST_ADDRESS,
        chainId: TEST_CHAIN_ID,
        eventName: "Transfer",
        fromBlock: 1n,
        toBlock: 10n,
      });

      const events = Chunk.toReadonlyArray(yield* Stream.runCollect(stream));
      expect(events).toHaveLength(1);
      expect(events[0]?.eventName).toBe("Transfer");
      expect(calls).toBeGreaterThanOrEqual(2);
    }).pipe(Effect.provide(layer));
  });

  it.live("surfaces a permanent getLogs failure as a typed EventBackfillError", () => {
    const layer = Layer.provide(
      EventBackfillLive,
      makeMockPublicClientLayer({
        getLogs: () => Promise.reject(new Error("rate limit exceeded")),
      })
    );

    return Effect.gen(function* () {
      const backfill = yield* EventBackfill;
      const stream = yield* backfill.fetch({
        abi: erc20Abi,
        address: TEST_ADDRESS,
        chainId: TEST_CHAIN_ID,
        eventName: "Transfer",
        fromBlock: 1n,
        toBlock: 10n,
      });

      // `flip` turns the typed error channel into the success value; a defect
      // would instead die here, failing the test.
      const error = yield* Stream.runCollect(stream).pipe(Effect.flip);
      expect(error).toBeInstanceOf(EventBackfillError);
      expect(error._tag).toBe("EventBackfillError");
      expect(error.chainId).toBe(TEST_CHAIN_ID);
    }).pipe(Effect.provide(layer));
  });

  it.live("maps a permanent head-block lookup failure to EventBackfillError", () => {
    const layer = Layer.provide(
      EventBackfillLive,
      makeMockPublicClientLayer({
        getBlockNumber: () => Promise.reject(new Error("rate limit exceeded")),
      })
    );

    return Effect.gen(function* () {
      const backfill = yield* EventBackfill;
      // toBlock omitted -> the head lookup runs and fails before the stream
      // exists, landing on the outer effect error channel as a typed error.
      const error = yield* backfill
        .fetch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          eventName: "Transfer",
          fromBlock: 1n,
        })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(EventBackfillError);
      expect((error as EventBackfillError)._tag).toBe("EventBackfillError");
    }).pipe(Effect.provide(layer));
  });
});
