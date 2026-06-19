import "server-only";

import { Clock, Deferred, Duration, Effect, Either, Exit, Schema } from "effect";

/**
 * Stored cache payload plus freshness metadata.
 *
 * @category models
 */
export type PersistentCacheEntry = {
  readonly value: unknown;
  readonly cachedAt: number;
  readonly expiresAt: number;
  readonly staleUntil: number | null;
};

/**
 * Minimal storage contract for cache-aside helpers.
 *
 * Implementations may use Redis, Upstash, KV, SQL, or any other backing store.
 * This package intentionally only ships an in-memory implementation.
 *
 * @category models
 */
export type PersistentCacheStore<R = never> = {
  readonly get: (key: string) => Effect.Effect<PersistentCacheEntry | null, unknown, R>;
  readonly set: (key: string, entry: PersistentCacheEntry) => Effect.Effect<void, unknown, R>;
  readonly delete: (key: string) => Effect.Effect<void, unknown, R>;
};

/**
 * Controls whether cache infrastructure failures are surfaced or bypassed.
 *
 * @category models
 */
export type CacheFailurePolicy = "fail-open" | "fail-closed";

/**
 * @category errors
 */
export class CacheReadError extends Schema.TaggedError<CacheReadError>()("CacheReadError", {
  cause: Schema.optional(Schema.Unknown),
  key: Schema.String,
  message: Schema.String,
}) {}

/**
 * @category errors
 */
export class CacheWriteError extends Schema.TaggedError<CacheWriteError>()("CacheWriteError", {
  cause: Schema.optional(Schema.Unknown),
  key: Schema.String,
  message: Schema.String,
}) {}

/**
 * @category errors
 */
export class CacheDecodeError extends Schema.TaggedError<CacheDecodeError>()("CacheDecodeError", {
  cause: Schema.optional(Schema.Unknown),
  key: Schema.String,
  message: Schema.String,
}) {}

/**
 * @category errors
 */
export class CacheRefreshError extends Schema.TaggedError<CacheRefreshError>()(
  "CacheRefreshError",
  {
    cause: Schema.optional(Schema.Unknown),
    key: Schema.String,
    message: Schema.String,
  }
) {}

/**
 * @category models
 */
export type CachedEffectOptions<A, StoreR = never> = {
  readonly key: string;
  readonly store: PersistentCacheStore<StoreR>;
  readonly ttl: Duration.DurationInput;
  readonly staleWhileRevalidate?: Duration.DurationInput;
  readonly schema?: Schema.Schema<A, never, never> | Schema.Schema.All;
  readonly failurePolicy?: CacheFailurePolicy;
};

/**
 * @category models
 */
export type CachedEffectWithKeyOptions<A, StoreR = never> = Omit<
  CachedEffectOptions<A, StoreR>,
  "key"
>;

/**
 * In-memory store for tests, local development, and single-process runtimes.
 *
 * @category constructors
 */
export function makeInMemoryPersistentCacheStore(): PersistentCacheStore & {
  readonly clear: Effect.Effect<void>;
  readonly size: Effect.Effect<number>;
} {
  const entries = new Map<string, PersistentCacheEntry>();

  return {
    clear: Effect.sync(() => {
      entries.clear();
    }),
    size: Effect.sync(() => entries.size),
    delete: (key) =>
      Effect.sync(() => {
        entries.delete(key);
      }),
    get: (key) => Effect.sync(() => entries.get(key) ?? null),
    set: (key, entry) =>
      Effect.sync(() => {
        entries.set(key, entry);
      }),
  };
}

type CacheResult<A> =
  | { readonly _tag: "miss" }
  | { readonly _tag: "fresh"; readonly value: A }
  | { readonly _tag: "stale"; readonly value: A };

type CacheHelperError = CacheReadError | CacheWriteError | CacheDecodeError | CacheRefreshError;

const inFlightByStore = new WeakMap<
  object,
  Map<string, Deferred.Deferred<unknown, CacheHelperError>>
>();

const toMillis = (input: Duration.DurationInput): number =>
  Math.max(0, Math.ceil(Duration.toMillis(input)));

const makeReadError = (key: string, cause: unknown) =>
  new CacheReadError({ cause, key, message: `Failed to read cache entry "${key}"` });

const makeWriteError = (key: string, cause: unknown) =>
  new CacheWriteError({ cause, key, message: `Failed to write cache entry "${key}"` });

const makeDecodeError = (key: string, cause: unknown) =>
  new CacheDecodeError({ cause, key, message: `Failed to decode cache entry "${key}"` });

const makeRefreshError = (key: string, cause: unknown) =>
  new CacheRefreshError({ cause, key, message: `Failed to refresh cache entry "${key}"` });

const getInFlightMap = <StoreR>(
  store: PersistentCacheStore<StoreR>
): Map<string, Deferred.Deferred<unknown, CacheHelperError>> => {
  const existing = inFlightByStore.get(store);
  if (existing) {
    return existing;
  }
  const created = new Map<string, Deferred.Deferred<unknown, CacheHelperError>>();
  inFlightByStore.set(store, created);
  return created;
};

const decodeValue = <A>(
  key: string,
  value: unknown,
  schema: Schema.Schema<A, never, never> | Schema.Schema.All | undefined
): Effect.Effect<A, CacheDecodeError> => {
  if (schema === undefined) {
    return Effect.succeed(value as A);
  }
  const schemaWithoutContext = schema as Schema.Schema<unknown, unknown, never>;
  return Schema.decodeUnknown(schemaWithoutContext)(value).pipe(
    Effect.map((decoded) => decoded as A),
    Effect.mapError((cause) => makeDecodeError(key, cause))
  );
};

const writeEntry = <StoreR>(
  store: PersistentCacheStore<StoreR>,
  key: string,
  entry: PersistentCacheEntry
): Effect.Effect<void, CacheWriteError, StoreR> =>
  store.set(key, entry).pipe(Effect.mapError((cause) => makeWriteError(key, cause)));

const deleteEntry = <StoreR>(
  store: PersistentCacheStore<StoreR>,
  key: string
): Effect.Effect<void, CacheWriteError, StoreR> =>
  store.delete(key).pipe(Effect.mapError((cause) => makeWriteError(key, cause)));

const deleteAfterDecodeFailure = <A, StoreR>(
  options: CachedEffectOptions<A, StoreR>,
  policy: CacheFailurePolicy,
  decodeError: CacheDecodeError
): Effect.Effect<CacheResult<A>, CacheWriteError | CacheDecodeError, StoreR> =>
  Effect.gen(function* () {
    const deleteResult = yield* deleteEntry(options.store, options.key).pipe(Effect.either);
    if (policy === "fail-open") {
      return { _tag: "miss" };
    }
    if (Either.isLeft(deleteResult)) {
      return yield* Effect.fail(deleteResult.left);
    }
    return yield* Effect.fail(decodeError);
  });

const deleteExpiredEntry = <A, StoreR>(
  options: CachedEffectOptions<A, StoreR>,
  policy: CacheFailurePolicy
): Effect.Effect<CacheResult<A>, CacheWriteError, StoreR> =>
  Effect.gen(function* () {
    const deleteResult = yield* deleteEntry(options.store, options.key).pipe(Effect.either);
    if (policy === "fail-closed" && Either.isLeft(deleteResult)) {
      return yield* Effect.fail(deleteResult.left);
    }
    return { _tag: "miss" };
  });

const classifyEntry = <A, StoreR>(
  options: CachedEffectOptions<A, StoreR>,
  policy: CacheFailurePolicy,
  entry: PersistentCacheEntry
): Effect.Effect<CacheResult<A>, CacheWriteError | CacheDecodeError, StoreR> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const isFresh = now <= entry.expiresAt;
    const isStale = entry.staleUntil !== null && now <= entry.staleUntil;

    if (!isFresh && !isStale) {
      return yield* deleteExpiredEntry(options, policy);
    }

    const decoded = yield* decodeValue<A>(options.key, entry.value, options.schema).pipe(
      Effect.either
    );
    if (Either.isLeft(decoded)) {
      return yield* deleteAfterDecodeFailure(options, policy, decoded.left);
    }

    if (isFresh) {
      return { _tag: "fresh", value: decoded.right };
    }
    return { _tag: "stale", value: decoded.right };
  });

const readCachedValue = <A, StoreR>(
  options: CachedEffectOptions<A, StoreR>,
  policy: CacheFailurePolicy
): Effect.Effect<CacheResult<A>, CacheReadError | CacheWriteError | CacheDecodeError, StoreR> =>
  Effect.gen(function* () {
    const readResult = yield* options.store.get(options.key).pipe(
      Effect.mapError((cause) => makeReadError(options.key, cause)),
      Effect.either
    );

    if (Either.isLeft(readResult)) {
      if (policy === "fail-open") {
        return { _tag: "miss" };
      }
      return yield* Effect.fail(readResult.left);
    }

    const entry = readResult.right;
    if (entry === null) {
      return { _tag: "miss" };
    }

    return yield* classifyEntry(options, policy, entry);
  });

const refreshValue = <A, R, StoreR>(
  effect: Effect.Effect<A, unknown, R>,
  options: CachedEffectOptions<A, StoreR>,
  policy: CacheFailurePolicy
): Effect.Effect<A, CacheDecodeError | CacheRefreshError | CacheWriteError, R | StoreR> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    if (Exit.isFailure(exit)) {
      return yield* Effect.fail(makeRefreshError(options.key, exit.cause));
    }

    const decoded = yield* decodeValue<A>(options.key, exit.value, options.schema);
    const now = yield* Clock.currentTimeMillis;
    const ttlMs = toMillis(options.ttl);
    const staleMs =
      options.staleWhileRevalidate === undefined ? 0 : toMillis(options.staleWhileRevalidate);
    const entry: PersistentCacheEntry = {
      cachedAt: now,
      expiresAt: now + ttlMs,
      staleUntil: staleMs > 0 ? now + ttlMs + staleMs : null,
      value: decoded,
    };

    const writeResult = yield* writeEntry(options.store, options.key, entry).pipe(Effect.either);
    if (Either.isLeft(writeResult) && policy === "fail-closed") {
      return yield* Effect.fail(writeResult.left);
    }
    return decoded;
  });

const coalesceRefresh = <A, R, StoreR>(
  effect: Effect.Effect<A, unknown, R>,
  options: CachedEffectOptions<A, StoreR>,
  policy: CacheFailurePolicy
): Effect.Effect<A, CacheDecodeError | CacheRefreshError | CacheWriteError, R | StoreR> =>
  Effect.suspend(() => {
    const inFlight = getInFlightMap(options.store);
    const existing = inFlight.get(options.key) as
      | Deferred.Deferred<A, CacheDecodeError | CacheRefreshError | CacheWriteError>
      | undefined;
    if (existing) {
      return Deferred.await(existing);
    }

    return Effect.gen(function* () {
      const deferred = yield* Deferred.make<
        A,
        CacheDecodeError | CacheRefreshError | CacheWriteError
      >();

      const state = yield* Effect.sync(() => {
        const current = inFlight.get(options.key) as
          | Deferred.Deferred<A, CacheDecodeError | CacheRefreshError | CacheWriteError>
          | undefined;
        if (current) {
          return { _tag: "existing" as const, deferred: current };
        }
        inFlight.set(options.key, deferred as Deferred.Deferred<unknown, CacheHelperError>);
        return { _tag: "created" as const };
      });

      if (state._tag === "existing") {
        return yield* Deferred.await(state.deferred);
      }

      const cleanup = Effect.sync(() => {
        if (inFlight.get(options.key) === deferred) {
          inFlight.delete(options.key);
        }
      });

      yield* Effect.uninterruptibleMask((restore) =>
        Effect.ensuring(
          Effect.intoDeferred(restore(refreshValue(effect, options, policy)), deferred),
          cleanup
        )
      );

      return yield* Deferred.await(deferred);
    });
  });

/**
 * Caches a single Effect under a fixed key.
 *
 * Cache reads and writes are fail-open by default because the cache is an
 * optimization boundary. Pass `failurePolicy: "fail-closed"` when cache
 * infrastructure failure should fail the request.
 *
 * @category utils
 */
export function cachedEffect<A, E, R, StoreR = never>(
  effect: Effect.Effect<A, E, R>,
  options: CachedEffectOptions<A, StoreR>
): Effect.Effect<A, CacheHelperError, R | StoreR> {
  const policy = options.failurePolicy ?? "fail-open";

  return Effect.gen(function* () {
    const cached = yield* readCachedValue(options, policy);

    if (cached._tag === "fresh") {
      return cached.value;
    }

    if (cached._tag === "stale") {
      yield* coalesceRefresh(effect, options, policy).pipe(
        Effect.catchAll(() => Effect.void),
        Effect.forkDaemon
      );
      return cached.value;
    }

    return yield* coalesceRefresh(effect, options, policy);
  });
}

/**
 * Caches an Effect-returning function using a derived cache key.
 *
 * @category utils
 */
export const cachedEffectWithKey =
  <Args extends readonly unknown[], A, E, R, StoreR = never>(
    effect: (...args: Args) => Effect.Effect<A, E, R>,
    key: (...args: Args) => string,
    options: CachedEffectWithKeyOptions<A, StoreR>
  ) =>
  (...args: Args): Effect.Effect<A, CacheHelperError, R | StoreR> =>
    cachedEffect(effect(...args), {
      ...options,
      key: key(...args),
    });
