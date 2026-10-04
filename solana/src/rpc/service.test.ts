import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { ConnectionNotFoundError } from "#src/core/errors/index.js";
import { expectTaggedFailure } from "#src/testing-kit/index.js";
import { makeRpcServiceLive, RpcService } from "./index.js";

describe("RPC connection identity", () => {
  it.effect("coalesces subscription connections per URL without expiry or eviction", () => {
    const config = {
      cluster: "devnet" as const,
      rpcUrl: "https://rpc.invalid",
      wsUrl: "wss://one.invalid",
    };
    return Effect.gen(function* () {
      const service = yield* RpcService;
      expect(yield* service.getRpc()).toBe(yield* service.getRpc());
      const [first, concurrent] = yield* Effect.all(
        [service.getRpcSubscriptions(), service.getRpcSubscriptions()],
        { concurrency: "unbounded" }
      );
      expect(first).toBe(concurrent);
      yield* TestClock.adjust("365 days");
      expect(yield* service.getRpcSubscriptions()).toBe(first);
      config.wsUrl = "wss://two.invalid";
      const second = yield* service.getRpcSubscriptions();
      expect(second).not.toBe(first);
      config.wsUrl = "wss://one.invalid";
      expect(yield* service.getRpcSubscriptions()).toBe(first);
    }).pipe(Effect.provide(makeRpcServiceLive(config)));
  });

  it.effect("retains the typed missing-WebSocket failure", () =>
    Effect.gen(function* () {
      const service = yield* RpcService;
      const exit = yield* Effect.exit(service.getRpcSubscriptions());
      expectTaggedFailure(exit, "ConnectionNotFoundError");
      if (exit._tag === "Failure") {
        expect(exit.cause.reasons[0]).toEqual(
          expect.objectContaining({ error: expect.any(ConnectionNotFoundError) })
        );
      }
    }).pipe(
      Effect.provide(makeRpcServiceLive({ cluster: "devnet", rpcUrl: "https://rpc.invalid" }))
    )
  );
});
