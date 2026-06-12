import { describe, expect, it } from "@effect/vitest";
import { Chunk, Effect, Layer, Stream } from "effect";
import type { Address } from "viem";
import { erc20Abi } from "viem";
import { EventWatchError } from "#src/core/index.js";
import type { DecodedEvent } from "#src/events/index.js";
import { EventStream, ReliableEventStream, ReliableEventStreamLive } from "#src/events/index.js";
import { makeMockPublicClientLayer, TEST_ADDRESS, TEST_CHAIN_ID } from "#src/testing-kit/index.js";

const transferEvent: DecodedEvent<typeof erc20Abi, "Transfer"> = {
  address: TEST_ADDRESS as Address,
  args: {
    from: "0x1234567890123456789012345678901234567890" as Address,
    to: "0x0987654321098765432109876543210987654321" as Address,
  },
  blockNumber: 1000n,
  eventName: "Transfer",
  logIndex: 0,
  removed: false,
  transactionHash: "0xabc123",
};

// EventStream mock that emits a single confirmed event then idles.
const SingleEventStreamLive = Layer.succeed(EventStream, {
  decodeReceipt: () => Effect.succeed([]),
  watch: () => Effect.succeed(Stream.make(transferEvent)),
} as EventStream["Type"]);

// EventStream mock whose stream fails with an EventWatchError.
const FailingEventStreamLive = Layer.succeed(EventStream, {
  decodeReceipt: () => Effect.succeed([]),
  watch: () =>
    Effect.succeed(
      Stream.fail(
        new EventWatchError({
          chainId: TEST_CHAIN_ID,
          message: "base stream blew up",
        })
      )
    ),
} as EventStream["Type"]);

describe("ReliableEventStream (resilience)", () => {
  it.live("keeps emitting after a transient getBlockNumber failure", () => {
    let polls = 0;
    const layer = Layer.provide(
      ReliableEventStreamLive,
      Layer.merge(
        SingleEventStreamLive,
        makeMockPublicClientLayer({
          getBlockNumber: () => {
            polls += 1;
            // First poll rejects with a retryable error; subsequent polls return
            // a head high enough to confirm the block-1000 event.
            if (polls === 1) {
              return Promise.reject(new Error("rate limit exceeded"));
            }
            return Promise.resolve(1002n);
          },
        })
      )
    );

    return Effect.gen(function* () {
      const reliable = yield* ReliableEventStream;
      const stream = yield* reliable.watch({
        abi: erc20Abi,
        address: TEST_ADDRESS,
        chainId: TEST_CHAIN_ID,
        confirmations: 1,
        eventName: "Transfer",
        pollingInterval: 20,
      });

      // The first confirmation poll fails and is retried; the event must still
      // be emitted once a later poll succeeds — proving the loop did not die.
      const events = yield* Stream.runCollect(Stream.take(stream, 1)).pipe(
        Effect.timeoutFail({
          duration: "5 seconds",
          onTimeout: () => new Error("event never emitted after transient poll failure"),
        })
      );

      expect(Chunk.toReadonlyArray(events)).toHaveLength(1);
      expect(polls).toBeGreaterThanOrEqual(2);
    }).pipe(Effect.provide(layer));
  });

  it.live("propagates a base-stream failure to the consumer", () => {
    const layer = Layer.provide(
      ReliableEventStreamLive,
      Layer.merge(
        FailingEventStreamLive,
        makeMockPublicClientLayer({
          getBlockNumber: async () => 1000n,
        })
      )
    );

    return Effect.gen(function* () {
      const reliable = yield* ReliableEventStream;
      const stream = yield* reliable.watch({
        abi: erc20Abi,
        address: TEST_ADDRESS,
        chainId: TEST_CHAIN_ID,
        confirmations: 1,
        eventName: "Transfer",
        pollingInterval: 20,
      });

      // The base stream fails; the reliable stream must fail too (not hang),
      // surfacing a typed EventWatchError instead of a silently-dead fiber.
      // `flip` exposes the typed error; a hang trips the timeout and a defect
      // would die here — both fail the test.
      const error = yield* Stream.runDrain(stream).pipe(
        Effect.timeoutFail({
          duration: "5 seconds",
          onTimeout: () => new EventWatchError({ chainId: -1, message: "stream hung" }),
        }),
        Effect.flip
      );

      expect(error).toBeInstanceOf(EventWatchError);
      expect(error._tag).toBe("EventWatchError");
      expect(error.chainId).toBe(TEST_CHAIN_ID);
    }).pipe(Effect.provide(layer));
  });
});
