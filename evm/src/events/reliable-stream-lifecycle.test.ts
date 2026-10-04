import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Stream } from "effect";
import type { PublicClient } from "viem";
import { erc20Abi } from "viem";
import { EventWatchError, PublicClientService } from "#src/core/index.js";
import type { EventStreamShape } from "#src/events/index.js";
import { EventStream, ReliableEventStream, ReliableEventStreamLive } from "#src/events/index.js";

function makeLayer(
  baseStream: Stream.Stream<never, EventWatchError>,
  getBlockNumber: () => Promise<bigint>
) {
  return Layer.provide(
    ReliableEventStreamLive,
    Layer.merge(
      Layer.succeed(EventStream, {
        decodeReceipt: () => Effect.succeed([]),
        watch: () => Effect.succeed(baseStream),
      } as EventStreamShape),
      Layer.succeed(PublicClientService, {
        get: () => Effect.succeed({ getBlockNumber } as unknown as PublicClient),
      })
    )
  );
}

const watchParams = {
  abi: erc20Abi,
  chainId: 1,
  eventName: "Transfer",
  pollingInterval: 5,
} as const;

describe("reliable stream lifetime", () => {
  it.effect("maps base-stream defects to a typed terminal error", () => {
    const defect = new Error("decoder defect");
    return Effect.gen(function* () {
      const service = yield* ReliableEventStream;
      const stream = yield* service.watch(watchParams);
      const error = yield* Stream.runDrain(stream).pipe(Effect.flip);
      expect(error).toBeInstanceOf(EventWatchError);
      expect(error.chainId).toBe(1);
      expect(error.cause).toBe(defect);
    }).pipe(Effect.provide(makeLayer(Stream.die(defect), async () => 1n)));
  });

  it.live("interrupts the base watcher and confirmation poller on consumer interruption", () => {
    let cleanupCount = 0;
    let pollCount = 0;
    const { promise: pollStarted, resolve: notifyPollStarted } = Promise.withResolvers<void>();
    const { promise: baseStarted, resolve: notifyBaseStarted } = Promise.withResolvers<void>();
    const base = Stream.callback<never, EventWatchError>(() =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            cleanupCount += 1;
          })
        );
        yield* Effect.sync(notifyBaseStarted);
      })
    );
    return Effect.gen(function* () {
      const service = yield* ReliableEventStream;
      const stream = yield* service.watch(watchParams);
      const fiber = yield* Stream.runDrain(stream).pipe(Effect.forkScoped);
      yield* Effect.promise(() => Promise.all([baseStarted, pollStarted]));
      yield* Fiber.interrupt(fiber);
      expect(cleanupCount).toBe(1);
      const stoppedAt = pollCount;
      yield* Effect.sleep("20 millis");
      expect(pollCount).toBe(stoppedAt);
    }).pipe(
      Effect.provide(
        makeLayer(base, () => {
          pollCount += 1;
          notifyPollStarted();
          return Promise.resolve(1n);
        })
      )
    );
  });
});
