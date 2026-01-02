import { describe, expect, it } from "@effect/vitest";
import { Cause, Chunk, Effect, Exit, Fiber, Stream, TestClock } from "effect";
import { constVoid as noop } from "effect/Function";
import type { Block } from "viem";
import { mainnet } from "viem/chains";
import { SubscriptionDroppedError, SubscriptionService } from "@/src/subscriptions/index.js";
import { makeEffectEvmTestLayer } from "@/src/testing-kit/index.js";

describe("SubscriptionService (Live)", () => {
  it.effect("fails Stream with SubscriptionDroppedError on watcher error", () => {
    const layer = makeEffectEvmTestLayer({
      publicClient: {
        watchBlocks: (params: unknown) => {
          const { onError } = params as {
            onError?: (error: unknown) => void;
          };
          onError?.(new Error("ws closed"));
          return noop;
        },
      },
    });

    return Effect.gen(function* () {
      const service = yield* SubscriptionService;
      const stream = yield* service.watchBlocks({ chainId: mainnet.id });

      const exit = yield* Effect.exit(Stream.runDrain(stream));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        expect(error._tag).toBe("Some");
        if (error._tag === "Some") {
          expect(error.value).toBeInstanceOf(SubscriptionDroppedError);
          if (error.value instanceof SubscriptionDroppedError) {
            expect(error.value.subscriptionType).toBe("blocks");
          }
        }
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect("retries and updates stateRef (watchBlocksRetrying)", () => {
    let calls = 0;
    const layer = makeEffectEvmTestLayer({
      publicClient: {
        watchBlocks: (params: unknown) => {
          calls += 1;
          const { onBlock, onError } = params as {
            onBlock?: (block: Block) => void;
            onError?: (error: unknown) => void;
          };

          if (calls === 1) {
            onError?.(new Error("boom"));
          } else {
            onBlock?.({ number: 123n } as unknown as Block);
          }

          return noop;
        },
      },
    });

    return Effect.gen(function* () {
      const service = yield* SubscriptionService;
      const { stateRef, stream } = yield* service.watchBlocksRetrying({
        chainId: mainnet.id,
        retry: { baseDelay: 1000, jitter: false, maxDelay: 1000 },
      });

      const statesFiber = yield* Effect.fork(
        stateRef.changes.pipe(Stream.take(4), Stream.runCollect)
      );
      const headFiber = yield* Effect.fork(Stream.runHead(stream));

      yield* TestClock.adjust("1 second");

      const result = yield* Fiber.join(headFiber);
      expect(result._tag).toBe("Some");
      if (result._tag === "Some") {
        expect(result.value.number).toBe(123n);
      }

      const states = Chunk.toArray(yield* Fiber.join(statesFiber));
      expect(states.some((s) => s.status === "retrying")).toBe(true);
      expect(states.at(-1)?.status).toBe("connected");
    }).pipe(Effect.provide(layer));
  });
});
