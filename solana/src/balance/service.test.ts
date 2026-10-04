import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { makeMockRpc, makeMockRpcServiceLayer, TEST_ADDRESS } from "#src/testing-kit/index.js";
import { BalanceService, BalanceServiceLive } from "./index.js";

describe("balance polling lifecycle", () => {
  it.effect("keeps polling until its consumer is interrupted", () => {
    let calls = 0;
    const rpcLayer = makeMockRpcServiceLayer({
      getRpc: () => Effect.succeed(makeMockRpc({ getBalance: () => Promise.resolve(++calls) })),
    });
    return Effect.gen(function* () {
      const first = yield* Deferred.make<void>();
      const second = yield* Deferred.make<void>();
      const values: bigint[] = [];
      const balance = yield* BalanceService;
      const stream = yield* balance.watchBalance({ address: TEST_ADDRESS, pollingInterval: 10 });
      const fiber = yield* Stream.runForEach(stream, (value) =>
        Effect.gen(function* () {
          values.push(value);
          yield* Deferred.succeed(values.length === 1 ? first : second, undefined);
        })
      ).pipe(Effect.forkChild);
      yield* Deferred.await(first);
      yield* TestClock.adjust("10 millis");
      yield* Deferred.await(second);
      expect(values).toEqual([1n, 2n]);
      yield* Fiber.interrupt(fiber);
      yield* TestClock.adjust("100 millis");
      expect(calls).toBe(2);
    }).pipe(Effect.provide(Layer.provide(BalanceServiceLive, rpcLayer)));
  });
});
