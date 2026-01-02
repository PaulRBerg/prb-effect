import type { Fiber } from "effect";
import { Context, Effect, Layer, Ref, Stream } from "effect";
import { ChainHead } from "@/src/query/chain-head.js";
import { RequestDedup, RpcCache } from "@/src/rpc/index.js";

export type QueryOptions = {
  readonly ttl?: number | undefined;
  readonly blockScoped?: boolean | undefined;
  readonly chainId?: number | undefined;
};

export type WatchOptions = QueryOptions & {
  readonly refetchOn: Stream.Stream<unknown, never>;
};

export type QueryClientShape = {
  readonly query: <A, E, R>(
    key: string,
    effect: Effect.Effect<A, E, R>,
    options?: QueryOptions | undefined
  ) => Effect.Effect<A, E, R>;

  readonly watch: <A, E, R>(
    key: string,
    effect: Effect.Effect<A, E, R>,
    options: WatchOptions
  ) => Stream.Stream<A, E, R>;
};

export class QueryClient extends Context.Tag("ew3/QueryClient")<QueryClient, QueryClientShape>() {}

export const QueryClientLive = Layer.scoped(
  QueryClient,
  Effect.gen(function* () {
    const cache = yield* RpcCache;
    const dedup = yield* RequestDedup;
    const chainHead = yield* ChainHead;
    const scope = yield* Effect.scope;

    type InvalidatorState = Fiber.RuntimeFiber<void, never> | "starting";
    const invalidatorsRef = yield* Ref.make(new Map<number, InvalidatorState>());

    const ensureInvalidator = (chainId: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const shouldStart = yield* Ref.modify(invalidatorsRef, (current) => {
          if (current.has(chainId)) {
            return [false, current] as const;
          }
          const next = new Map(current);
          next.set(chainId, "starting");
          return [true, next] as const;
        });

        if (!shouldStart) {
          return;
        }

        const stream = yield* chainHead.watch(chainId);
        const started = Stream.runForEach(stream, (blockNumber) =>
          cache.invalidateBlock(blockNumber)
        )
          .pipe(Effect.forkIn(scope))
          .pipe(
            Effect.tap((fiber) =>
              Ref.update(invalidatorsRef, (current) => {
                const next = new Map(current);
                next.set(chainId, fiber);
                return next;
              })
            ),
            Effect.catchAll(() =>
              Ref.update(invalidatorsRef, (current) => {
                const next = new Map(current);
                next.delete(chainId);
                return next;
              })
            )
          );

        yield* started;
      }).pipe(Effect.catchAll(() => Effect.void));

    const query: QueryClientShape["query"] = <A, E, R>(
      key: string,
      effect: Effect.Effect<A, E, R>,
      options?: QueryOptions | undefined
    ) =>
      Effect.gen(function* () {
        if (options?.blockScoped && options.chainId !== undefined) {
          yield* ensureInvalidator(options.chainId);
        }

        const cached = yield* cache.get<A>(key);
        if (cached !== null) {
          return cached;
        }

        return yield* dedup.dedupe(key, effect).pipe(
          Effect.tap((value) =>
            Effect.gen(function* () {
              if (options?.blockScoped && options.chainId !== undefined) {
                const current = yield* chainHead.current(options.chainId).pipe(Effect.either);
                if (current._tag === "Right") {
                  yield* cache.set(key, value, current.right, options.ttl);
                  return;
                }
              }
              yield* cache.set(key, value, undefined, options?.ttl);
            })
          )
        );
      });

    const watch: QueryClientShape["watch"] = <A, E, R>(
      key: string,
      effect: Effect.Effect<A, E, R>,
      options: WatchOptions
    ) => {
      const initial = Stream.fromEffect(query(key, effect, options));
      const refetch = options.refetchOn.pipe(Stream.mapEffect(() => query(key, effect, options)));
      return Stream.concat(initial, refetch);
    };

    return QueryClient.of({ query, watch });
  })
);
