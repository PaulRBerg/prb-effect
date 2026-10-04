import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Ref, Stream, SubscriptionRef } from "effect";
import { ChainHead, QueryClient, QueryClientLive } from "#src/query/index.js";
import { makeRpcCacheLive, RequestDedupLive, RpcCache } from "#src/rpc/index.js";
import { TEST_CHAIN_ID } from "#src/testing-kit/index.js";

describe("QueryClient", () => {
  it.effect("owns one invalidator per chain until the query layer closes", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let watches = 0;
      let active = 0;
      const layer = Layer.provide(
        QueryClientLive,
        Layer.mergeAll(
          Layer.succeed(
            ChainHead,
            ChainHead.of({
              current: () => Effect.succeed(1n),
              watch: () => {
                watches += 1;
                return Effect.succeed(
                  Stream.callback<bigint>(() =>
                    Effect.gen(function* () {
                      active += 1;
                      yield* Effect.addFinalizer(() =>
                        Effect.sync(() => {
                          active -= 1;
                        })
                      );
                      yield* Deferred.succeed(started, undefined);
                    })
                  )
                );
              },
            })
          ),
          makeRpcCacheLive(),
          RequestDedupLive
        )
      );

      yield* Effect.gen(function* () {
        const queryClient = yield* QueryClient;
        yield* queryClient.query("owned-invalidator-1", Effect.succeed(1), {
          blockScoped: true,
          chainId: TEST_CHAIN_ID,
        });
        yield* Deferred.await(started);
        yield* queryClient.query("owned-invalidator-2", Effect.succeed(2), {
          blockScoped: true,
          chainId: TEST_CHAIN_ID,
        });
        expect(watches).toBe(1);
        expect(active).toBe(1);
      }).pipe(Effect.provide(layer));

      expect(active).toBe(0);
    })
  );

  it.effect("caches repeated queries", () =>
    Effect.gen(function* () {
      const queryClient = yield* QueryClient;

      let executions = 0;
      const effect = Effect.sync(() => {
        executions += 1;
        return "value";
      });

      const result1 = yield* queryClient.query("key", effect, { ttl: 60_000 });
      const result2 = yield* queryClient.query("key", effect, { ttl: 60_000 });

      expect(result1).toBe("value");
      expect(result2).toBe("value");
      expect(executions).toBe(1);
    }).pipe(
      Effect.provide(
        Layer.provide(
          QueryClientLive,
          Layer.mergeAll(
            Layer.succeed(
              ChainHead,
              ChainHead.of({
                current: () => Effect.succeed(1n),
                watch: () => Effect.succeed(Stream.empty),
              })
            ),
            makeRpcCacheLive({ ttl: 60_000 }),
            RequestDedupLive
          )
        )
      )
    )
  );

  it.effect("dedupes concurrent queries with the same key", () =>
    Effect.gen(function* () {
      const queryClient = yield* QueryClient;
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();

      let executions = 0;
      const effect = Effect.gen(function* () {
        executions += 1;
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(gate);
        return "shared";
      });

      const fiber1 = yield* Effect.forkChild(queryClient.query("key", effect, { ttl: 60_000 }));
      const fiber2 = yield* Effect.forkChild(queryClient.query("key", effect, { ttl: 60_000 }));

      yield* Deferred.await(started);
      yield* Deferred.succeed(gate, undefined);

      const result1 = yield* Fiber.join(fiber1);
      const result2 = yield* Fiber.join(fiber2);

      expect(result1).toBe("shared");
      expect(result2).toBe("shared");
      expect(executions).toBe(1);
    }).pipe(
      Effect.provide(
        Layer.provide(
          QueryClientLive,
          Layer.mergeAll(
            Layer.succeed(
              ChainHead,
              ChainHead.of({
                current: () => Effect.succeed(1n),
                watch: () => Effect.succeed(Stream.empty),
              })
            ),
            makeRpcCacheLive({ ttl: 60_000 }),
            RequestDedupLive
          )
        )
      )
    )
  );

  it.effect("invalidates block-scoped cache entries on new head blocks", () =>
    Effect.gen(function* () {
      const headRef = yield* SubscriptionRef.make(1n);
      const watchStarted = yield* Deferred.make<void>();
      const invalidated = yield* Deferred.make<void>();
      const invalidationsRef = yield* Ref.make<readonly bigint[]>([]);

      const queryClientLayer = Layer.provideMerge(
        QueryClientLive,
        Layer.mergeAll(
          Layer.succeed(
            ChainHead,
            ChainHead.of({
              current: () => SubscriptionRef.get(headRef),
              watch: () =>
                Effect.succeed(
                  SubscriptionRef.changes(headRef).pipe(
                    Stream.onStart(Deferred.succeed(watchStarted, undefined))
                  )
                ),
            })
          ),
          Layer.provide(
            Layer.effect(
              RpcCache,
              Effect.gen(function* () {
                const base = yield* RpcCache;
                return RpcCache.of({
                  ...base,
                  invalidateBlock: (blockNumber) =>
                    base.invalidateBlock(blockNumber).pipe(
                      Effect.tap(() =>
                        Ref.update(invalidationsRef, (current) => [...current, blockNumber])
                      ),
                      Effect.tap(() =>
                        blockNumber === 2n
                          ? Deferred.succeed(invalidated, undefined).pipe(Effect.asVoid)
                          : Effect.void
                      )
                    ),
                });
              })
            ),
            makeRpcCacheLive({ ttl: 60_000 })
          ),
          RequestDedupLive
        )
      );

      return yield* Effect.gen(function* () {
        const queryClient = yield* QueryClient;
        const cache = yield* RpcCache;

        let executions = 0;
        const effect = Effect.sync(() => {
          executions += 1;
          return "value";
        });

        const result1 = yield* queryClient.query("key", effect, {
          blockScoped: true,
          chainId: TEST_CHAIN_ID,
          ttl: 60_000,
        });

        expect(yield* cache.get<string>("key")).toBe("value");

        yield* Deferred.await(watchStarted);

        // Set the new block - this will trigger invalidation through the changes stream
        yield* SubscriptionRef.set(headRef, 2n);

        yield* Deferred.await(invalidated);
        expect(yield* cache.get<string>("key")).toBeNull();
        expect(yield* Ref.get(invalidationsRef)).toContain(2n);

        const result2 = yield* queryClient.query("key", effect, {
          blockScoped: true,
          chainId: TEST_CHAIN_ID,
          ttl: 60_000,
        });

        expect(result1).toBe("value");
        expect(result2).toBe("value");
        expect(executions).toBe(2);
      }).pipe(Effect.provide(queryClientLayer));
    }).pipe(Effect.scoped)
  );
});
