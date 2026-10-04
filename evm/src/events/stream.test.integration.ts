import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Stream } from "effect";
import { constVoid as noop } from "effect/Function";
import type { Log, TransactionReceipt, WatchContractEventParameters } from "viem";
import { erc20Abi } from "viem";
import { MIN_TX_GAS } from "#src/constants/index.js";
import { EventStream, EventStreamLive } from "#src/events/index.js";
import {
  makeMockPublicClientLayer,
  TEST_ADDRESS,
  TEST_CHAIN_ID,
  UNKNOWN_CHAIN_ID,
} from "#src/testing-kit/index.js";

describe("EventStream", () => {
  describe("watch", () => {
    it.effect("returns Stream that emits decoded events", () =>
      Effect.gen(function* () {
        const stream = yield* EventStream;
        const eventStream = yield* stream.watch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          eventName: "Transfer",
        });

        const events = yield* Stream.runCollect(Stream.take(eventStream, 1));
        const eventArray = events;

        expect(eventArray).toHaveLength(1);
        expect(eventArray[0].eventName).toBe("Transfer");
      }).pipe(
        Effect.provide(
          Layer.provide(
            EventStreamLive,
            makeMockPublicClientLayer({
              watchContractEvent: (params: WatchContractEventParameters) => {
                setTimeout(() => {
                  if (params.onLogs) {
                    params.onLogs([
                      {
                        address: TEST_ADDRESS,
                        blockHash: "0xblockhash",
                        blockNumber: 100n,
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
                    ] satisfies Log[]);
                  }
                }, 10);
                return noop;
              },
            })
          )
        )
      )
    );

    it.effect("returns ClientNotFoundError for unknown chainId", () =>
      Effect.gen(function* () {
        const stream = yield* EventStream;
        const exit = yield* Effect.exit(
          stream.watch({
            abi: erc20Abi,
            address: TEST_ADDRESS,
            chainId: UNKNOWN_CHAIN_ID,
            eventName: "Transfer",
          })
        );

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(Effect.provide(Layer.provide(EventStreamLive, makeMockPublicClientLayer())))
    );

    it.effect("Stream fails with EventWatchError when onError is called", () =>
      Effect.gen(function* () {
        const stream = yield* EventStream;
        const eventStream = yield* stream.watch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          eventName: "Transfer",
        });

        const exit = yield* Effect.exit(Stream.runCollect(eventStream));
        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EventStreamLive,
            makeMockPublicClientLayer({
              watchContractEvent: (params: WatchContractEventParameters) => {
                setTimeout(() => {
                  if (params.onError) {
                    params.onError(new Error("Watch error"));
                  }
                }, 10);
                return noop;
              },
            })
          )
        )
      )
    );
  });

  describe("decodeReceipt", () => {
    it.effect("decodes events from receipt", () =>
      Effect.gen(function* () {
        const stream = yield* EventStream;

        const mockReceipt: TransactionReceipt = {
          blockHash: "0xblock",
          blockNumber: 100n,
          contractAddress: null,
          cumulativeGasUsed: MIN_TX_GAS,
          effectiveGasPrice: 1n,
          from: "0xfrom",
          gasUsed: MIN_TX_GAS,
          logsBloom: "0x",
          status: "success",
          to: "0xto",
          transactionHash: "0xtxhash",
          transactionIndex: 0,
          type: "0x2",
          logs: [
            {
              address: TEST_ADDRESS,
              blockHash: "0xblock",
              blockNumber: 100n,
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
          ],
        };

        const events = yield* stream.decodeReceipt(mockReceipt, erc20Abi);

        expect(events).toHaveLength(1);
        expect(events[0].eventName).toBe("Transfer");
      }).pipe(Effect.provide(Layer.provide(EventStreamLive, makeMockPublicClientLayer())))
    );
  });
});
