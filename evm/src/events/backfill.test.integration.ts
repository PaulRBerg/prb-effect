import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import type { GetLogsParameters } from "viem";
import { erc20Abi } from "viem";
import { EventBackfill, EventBackfillLive } from "#src/events/index.js";
import { makeMockPublicClientLayer, TEST_ADDRESS, TEST_CHAIN_ID } from "#src/testing-kit/index.js";

describe("EventBackfill", () => {
  describe("fetch", () => {
    it.effect("returns Stream that fetches historical events in batches", () =>
      Effect.gen(function* () {
        const backfill = yield* EventBackfill;
        const eventStream = yield* backfill.fetch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          batchSize: 5n,
          chainId: TEST_CHAIN_ID,
          eventName: "Transfer",
          fromBlock: 1n,
          toBlock: 10n,
        });

        const events = yield* Stream.runCollect(eventStream);
        const eventArray = events;

        // Should have fetched 2 events (one per batch)
        expect(eventArray).toHaveLength(2);
        expect(eventArray[0].eventName).toBe("Transfer");
        expect(eventArray[1].eventName).toBe("Transfer");
      }).pipe(
        Effect.provide(
          Layer.provide(
            EventBackfillLive,
            makeMockPublicClientLayer({
              getLogs: (params: GetLogsParameters) => {
                // Return one event per batch
                return Promise.resolve([
                  {
                    address: TEST_ADDRESS,
                    blockHash: "0xblockhash",
                    blockNumber: (params as any).fromBlock ?? 1n,
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
                  },
                ]);
              },
            } as any)
          )
        )
      )
    );

    it.effect("uses current block as toBlock when not specified", () =>
      Effect.gen(function* () {
        const backfill = yield* EventBackfill;
        const eventStream = yield* backfill.fetch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          eventName: "Transfer",
          fromBlock: 1n,
        });

        const events = yield* Stream.runCollect(eventStream);
        const eventArray = events;

        expect(eventArray).toHaveLength(1);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EventBackfillLive,
            makeMockPublicClientLayer({
              getBlockNumber: async () => 100n,
              getLogs: () =>
                Promise.resolve([
                  {
                    address: TEST_ADDRESS,
                    blockHash: "0xblockhash",
                    blockNumber: 50n,
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
                  },
                ]),
            } as any)
          )
        )
      )
    );
  });

  describe("fetchAll", () => {
    it.effect("returns all historical events as array", () =>
      Effect.gen(function* () {
        const backfill = yield* EventBackfill;
        const events = yield* backfill.fetchAll({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          eventName: "Transfer",
          fromBlock: 1n,
          toBlock: 10n,
        });

        expect(events).toHaveLength(1);
        expect(events[0].eventName).toBe("Transfer");
      }).pipe(
        Effect.provide(
          Layer.provide(
            EventBackfillLive,
            makeMockPublicClientLayer({
              getLogs: () =>
                Promise.resolve([
                  {
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
                  },
                ]),
            } as any)
          )
        )
      )
    );
  });
});
