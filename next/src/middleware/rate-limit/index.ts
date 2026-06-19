import "server-only";

import { Clock, Duration, Effect, Either, Layer, Schema } from "effect";
import { Tag } from "../index.js";

/**
 * @category models
 */
export type RateLimitIncrement = {
  readonly count: number;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: number;
};

/**
 * Abstract fixed-window rate-limit storage.
 *
 * @category models
 */
export type RateLimitStore = {
  readonly increment: (
    key: string,
    windowSeconds: number,
    limit: number
  ) => Effect.Effect<RateLimitIncrement, unknown>;
};

/**
 * @category models
 */
export type RateLimitFailurePolicy = "fail-open" | "fail-closed";

/**
 * @category models
 */
export type RateLimitKeyContext = {
  readonly props: unknown;
  readonly request: Request | null;
  readonly method: string | null;
  readonly path: string | null;
  readonly getHeader: (name: string) => string | null;
};

/**
 * @category models
 */
export type RateLimitKeyResolver = (
  context: RateLimitKeyContext
) => Effect.Effect<string, never, never>;

/**
 * @category models
 */
export type RateLimitOptions = {
  readonly store: RateLimitStore;
  readonly limit: number;
  readonly window: Duration.DurationInput;
  readonly key?: RateLimitKeyResolver;
  readonly failurePolicy?: RateLimitFailurePolicy;
};

/**
 * @category errors
 */
export class RateLimitExceeded extends Schema.TaggedError<RateLimitExceeded>()(
  "RateLimitExceeded",
  {
    key: Schema.String,
    limit: Schema.Number,
    message: Schema.String,
    remaining: Schema.Number,
    resetAt: Schema.Number,
  }
) {}

/**
 * @category errors
 */
export class RateLimitStoreError extends Schema.TaggedError<RateLimitStoreError>()(
  "RateLimitStoreError",
  {
    cause: Schema.optional(Schema.Unknown),
    key: Schema.String,
    message: Schema.String,
  }
) {}

/**
 * @category tags
 */
export class RateLimitMiddleware extends Tag<RateLimitMiddleware>()(
  "effect-next/RateLimitMiddleware",
  { failure: Schema.Union(RateLimitExceeded, RateLimitStoreError) }
) {}

const DEFAULT_IP_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "x-vercel-forwarded-for",
] as const;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;

const isHeadersLike = (
  value: unknown
): value is { readonly get: (name: string) => string | null } => {
  const record = asRecord(value);
  return record !== null && typeof record.get === "function";
};

const isRequestLike = (value: unknown): value is Request => {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.method === "string" &&
    typeof record.url === "string" &&
    isHeadersLike(record.headers)
  );
};

const propsToArray = (props: unknown): readonly unknown[] =>
  Array.isArray(props) ? props : [props];

/**
 * Extracts the first Request-like object from middleware props.
 *
 * @category utils
 */
export const requestFromProps = (props: unknown): Request | null => {
  for (const prop of propsToArray(props)) {
    if (isRequestLike(prop)) {
      return prop;
    }
  }
  return null;
};

const pathFromRequest = (request: Request | null): string | null => {
  if (request === null) {
    return null;
  }
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url;
  }
};

const firstForwardedValue = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }
  const first = value.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
};

const makeKeyContext = (props: unknown): RateLimitKeyContext => {
  const request = requestFromProps(props);
  return {
    method: request?.method ?? null,
    path: pathFromRequest(request),
    getHeader: (name) => request?.headers.get(name) ?? null,
    props,
    request,
  };
};

/**
 * Key resolver builders for common route-handler request dimensions.
 *
 * @category utils
 */
export const rateLimitKey = {
  combine:
    (...resolvers: readonly RateLimitKeyResolver[]): RateLimitKeyResolver =>
    (context) =>
      Effect.gen(function* () {
        const parts = yield* Effect.forEach(resolvers, (resolver) => resolver(context));
        return parts.join("|");
      }),
  custom: (resolver: RateLimitKeyResolver): RateLimitKeyResolver => resolver,
  header:
    (name: string, fallback = `missing:${name}`): RateLimitKeyResolver =>
    (context) =>
      Effect.succeed(`header:${name}:${context.getHeader(name) ?? fallback}`),
  /**
   * Uses proxy-provided IP headers. Only use this behind infrastructure that
   * overwrites client-supplied forwarding headers.
   */
  ip:
    (headers: readonly string[] = DEFAULT_IP_HEADERS): RateLimitKeyResolver =>
    (context) =>
      Effect.succeed(
        `ip:${
          headers
            .map((header) => firstForwardedValue(context.getHeader(header)))
            .find((value) => value !== null) ?? "unknown-ip"
        }`
      ),
  method:
    (fallback = "unknown-method"): RateLimitKeyResolver =>
    (context) =>
      Effect.succeed(`method:${context.method ?? fallback}`),
  path:
    (fallback = "unknown-path"): RateLimitKeyResolver =>
    (context) =>
      Effect.succeed(`path:${context.path ?? fallback}`),
};

const defaultKey = rateLimitKey.combine(
  rateLimitKey.method(),
  rateLimitKey.path(),
  rateLimitKey.ip()
);

const toPositiveInteger = (input: number): number =>
  Number.isFinite(input) ? Math.max(1, Math.floor(input)) : 1;

const toWindowSeconds = (input: Duration.DurationInput): number =>
  toPositiveInteger(Math.ceil(Duration.toMillis(input) / 1000));

/**
 * In-memory fixed-window store for tests and local development.
 *
 * @category constructors
 */
export function makeInMemoryRateLimitStore(): RateLimitStore & {
  readonly clear: Effect.Effect<void>;
} {
  const entries = new Map<string, { count: number; resetAt: number }>();
  let nextPruneAt = 0;
  const pruneExpired = (now: number, windowSeconds: number) => {
    if (now < nextPruneAt) {
      return;
    }

    for (const [key, entry] of entries) {
      if (now >= entry.resetAt) {
        entries.delete(key);
      }
    }
    nextPruneAt = now + windowSeconds * 1000;
  };

  return {
    clear: Effect.sync(() => {
      entries.clear();
      nextPruneAt = 0;
    }),
    increment: (key, windowSeconds, limit) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        pruneExpired(now, windowSeconds);
        const current = entries.get(key);
        const next =
          current === undefined || now >= current.resetAt
            ? { count: 1, resetAt: now + windowSeconds * 1000 }
            : { count: current.count + 1, resetAt: current.resetAt };

        entries.set(key, next);

        return {
          count: next.count,
          limit,
          remaining: Math.max(0, limit - next.count),
          resetAt: next.resetAt,
        };
      }),
  };
}

/**
 * Creates a generic fixed-window rate-limit middleware layer.
 *
 * @category layers
 */
export const makeRateLimitMiddleware = (
  options: RateLimitOptions
): Layer.Layer<RateLimitMiddleware, never, never> => {
  const keyResolver = options.key ?? defaultKey;
  const failurePolicy = options.failurePolicy ?? "fail-closed";
  const limit = toPositiveInteger(options.limit);
  const windowSeconds = toWindowSeconds(options.window);

  return Layer.succeed(RateLimitMiddleware, ({ props }) =>
    Effect.gen(function* () {
      const context = makeKeyContext(props);
      const key = yield* keyResolver(context);
      const increment = yield* options.store.increment(key, windowSeconds, limit).pipe(
        Effect.mapError(
          (cause) =>
            new RateLimitStoreError({
              cause,
              key,
              message: `Failed to increment rate-limit key "${key}"`,
            })
        ),
        Effect.either
      );

      if (Either.isLeft(increment)) {
        if (failurePolicy === "fail-open") {
          return;
        }
        return yield* Effect.fail(increment.left);
      }

      const result = increment.right;
      if (result.count <= result.limit) {
        return;
      }

      return yield* Effect.fail(
        new RateLimitExceeded({
          key,
          limit: result.limit,
          message: `Rate limit exceeded for "${key}"`,
          remaining: result.remaining,
          resetAt: result.resetAt,
        })
      );
    })
  );
};
