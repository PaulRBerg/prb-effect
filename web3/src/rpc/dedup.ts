import { Context, Deferred, Effect, Layer } from "effect";

/**
 * Deduplicates concurrent identical requests
 */
export type RequestDedupShape = {
  readonly dedupe: <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
};

export class RequestDedup extends Context.Tag("ew3/RequestDedup")<
  RequestDedup,
  RequestDedupShape
>() {}

/**
 * Global mutable map - JavaScript Map is synchronous and truly shared
 */
const globalInflight = new Map<string, Deferred.Deferred<unknown, unknown>>();

/**
 * Uses synchronous map access with Effect.suspend for atomic check-then-create
 */
export const RequestDedupLive: Layer.Layer<RequestDedup> = Layer.succeed(RequestDedup, {
  dedupe: <A, E, R>(key: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    // Use suspend to defer the entire check logic
    Effect.suspend(() => {
      // Synchronous check - if entry exists, return effect that waits on it
      const existing = globalInflight.get(key) as Deferred.Deferred<A, E> | undefined;
      if (existing) {
        return Deferred.await(existing);
      }

      // Need to create new entry - this is the critical section
      // Create the deferred, add to map, then run the effect
      return Effect.gen(function* () {
        const deferred = yield* Deferred.make<A, E>();

        // Synchronously add to map - check again in case of race
        const raceCheck = Effect.sync(() => {
          const current = globalInflight.get(key) as Deferred.Deferred<A, E> | undefined;
          if (current) {
            return { _tag: "raced" as const, existing: current };
          }
          globalInflight.set(key, deferred as Deferred.Deferred<unknown, unknown>);
          return { _tag: "added" as const };
        });

        const result = yield* raceCheck;
        if (result._tag === "raced") {
          // Another fiber beat us - wait on their deferred
          return yield* Deferred.await(result.existing);
        }

        const cleanup = Effect.sync(() => {
          const current = globalInflight.get(key);
          if (current === (deferred as Deferred.Deferred<unknown, unknown>)) {
            globalInflight.delete(key);
          }
        });

        // Run the effect and complete deferred with result
        yield* Effect.uninterruptibleMask((restore) =>
          Effect.ensuring(Effect.intoDeferred(restore(effect), deferred), cleanup)
        );

        return yield* Deferred.await(deferred);
      });
    }),
} satisfies RequestDedupShape);

/**
 * Reset global state (for testing)
 * @internal
 */
export const _resetDedupState = (): void => {
  globalInflight.clear();
};
