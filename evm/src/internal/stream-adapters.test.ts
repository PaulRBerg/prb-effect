import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Result, Stream } from "effect";
import { fromWatchCallback } from "./stream-adapters.js";

describe("fromWatchCallback", () => {
  it.effect("buffers synchronous events and keeps the watch alive until consumption ends", () =>
    Effect.gen(function* () {
      let unsubscribed = 0;
      const stream = fromWatchCallback<number, string>({
        mapError: String,
        watch: ({ onData }) => {
          onData(1);
          onData(2);
          onData(3);
          return () => {
            unsubscribed += 1;
          };
        },
      });

      const values = yield* stream.pipe(
        Stream.take(3),
        Stream.tap(() =>
          Effect.sync(() => {
            expect(unsubscribed).toBe(0);
          })
        ),
        Stream.runCollect
      );

      expect(values).toEqual([1, 2, 3]);
      expect(unsubscribed).toBe(1);
    })
  );

  it.effect("drains queued events before a mapped failure and unsubscribes once", () =>
    Effect.gen(function* () {
      const values: number[] = [];
      const error = new Error("watch failed");
      let unsubscribed = 0;
      const stream = fromWatchCallback<number, Error>({
        mapError: () => error,
        watch: ({ onData, onError }) => {
          onData(1);
          onError("transport failure");
          onData(2);
          return () => {
            unsubscribed += 1;
          };
        },
      });

      const result = yield* Stream.runForEach(stream, (value) =>
        Effect.sync(() => {
          values.push(value);
        })
      ).pipe(Effect.result);

      expect(values).toEqual([1]);
      expect(Result.isFailure(result) && result.failure).toBe(error);
      expect(unsubscribed).toBe(1);
    })
  );

  it.effect("unsubscribes when the consumer is interrupted", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let unsubscribed = 0;
      const stream = fromWatchCallback<number, never>({
        mapError: () => {
          throw new Error("unexpected failure");
        },
        watch: () => {
          Deferred.doneUnsafe(started, Effect.void);
          return () => {
            unsubscribed += 1;
          };
        },
      });

      const fiber = yield* Effect.forkChild(Stream.runDrain(stream));
      yield* Deferred.await(started);
      expect(unsubscribed).toBe(0);
      yield* Fiber.interrupt(fiber);
      expect(unsubscribed).toBe(1);
    })
  );
});
