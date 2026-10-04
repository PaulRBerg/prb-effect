import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import type { Address, Block, Hash, Hex, Log } from "viem";
import { DEFAULT_MAX_DELAY, DEFAULT_SUBSCRIPTION_BASE_DELAY } from "#src/constants/index.js";
import type { ClientNotFoundError } from "#src/core/index.js";
import { PublicClientService } from "#src/core/index.js";
import { makeBackoffSchedule } from "#src/internal/index.js";
import { watchBlocks } from "./block-subscription.js";
import type { SubscriptionDroppedError, SubscriptionNotSupportedError } from "./errors.js";
import { watchLogs } from "./log-subscription.js";
import { watchPendingTxs } from "./pending-tx.js";

export type SubscriptionRetryConfig = {
  /**
   * Base delay in milliseconds for exponential backoff (default: 500ms)
   */
  readonly baseDelay?: number;
  /**
   * Maximum delay in milliseconds between retries (default: 30s)
   */
  readonly maxDelay?: number;
  /**
   * Add jitter to retry delays (default: true)
   */
  readonly jitter?: boolean;
};

export type SubscriptionConnectionState =
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "retrying"; error: SubscriptionDroppedError };

export type RetryingSubscriptionStream<A> = {
  readonly stateRef: SubscriptionRef.SubscriptionRef<SubscriptionConnectionState>;
  readonly stream: Stream.Stream<A, never>;
};

const makeSubscriptionRetrySchedule = (config?: SubscriptionRetryConfig) =>
  makeBackoffSchedule({
    baseDelay: config?.baseDelay ?? DEFAULT_SUBSCRIPTION_BASE_DELAY,
    jitter: config?.jitter ?? true,
    maxDelay: config?.maxDelay ?? DEFAULT_MAX_DELAY,
    maxRetries: Number.POSITIVE_INFINITY, // subscriptions retry forever
  });

const neverStream = <A>(): Stream.Stream<A, never> => Stream.never;

export type SubscriptionServiceShape = {
  readonly watchBlocks: (params: {
    chainId: number;
    includeTransactions?: boolean;
    pollingInterval?: number;
  }) => Effect.Effect<Stream.Stream<Block, SubscriptionDroppedError>, ClientNotFoundError>;

  readonly watchLogs: (params: {
    chainId: number;
    address?: Address | Address[];
    topics?: (Hex | Hex[] | null)[];
    pollingInterval?: number;
  }) => Effect.Effect<Stream.Stream<Log, SubscriptionDroppedError>, ClientNotFoundError>;

  readonly watchPendingTxs: (params: {
    chainId: number;
    pollingInterval?: number;
  }) => Effect.Effect<
    Stream.Stream<Hash, SubscriptionDroppedError>,
    SubscriptionNotSupportedError | ClientNotFoundError
  >;

  readonly watchBlocksRetrying: (params: {
    chainId: number;
    includeTransactions?: boolean;
    pollingInterval?: number;
    retry?: SubscriptionRetryConfig;
  }) => Effect.Effect<RetryingSubscriptionStream<Block>, ClientNotFoundError>;

  readonly watchLogsRetrying: (params: {
    chainId: number;
    address?: Address | Address[];
    topics?: (Hex | Hex[] | null)[];
    pollingInterval?: number;
    retry?: SubscriptionRetryConfig;
  }) => Effect.Effect<RetryingSubscriptionStream<Log>, ClientNotFoundError>;

  readonly watchPendingTxsRetrying: (params: {
    chainId: number;
    pollingInterval?: number;
    retry?: SubscriptionRetryConfig;
  }) => Effect.Effect<
    RetryingSubscriptionStream<Hash>,
    SubscriptionNotSupportedError | ClientNotFoundError
  >;

  readonly hasWebSocket: (chainId: number) => Effect.Effect<boolean, ClientNotFoundError>;
};

export class SubscriptionService extends Context.Service<
  SubscriptionService,
  SubscriptionServiceShape
>()("ew3/SubscriptionService") {}

export const SubscriptionServiceLive = Layer.effect(
  SubscriptionService,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;

    return {
      hasWebSocket: (chainId) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(chainId);
          // Check if transport is WebSocket-based
          return client.transport.type === "webSocket";
        }),
      watchBlocks: (params) => watchBlocks(publicClientService, params),

      watchBlocksRetrying: (params) =>
        Effect.gen(function* () {
          const stateRef = yield* SubscriptionRef.make<SubscriptionConnectionState>({
            status: "connecting",
          });

          const { retry, ...watchParams } = params;
          const schedule = makeSubscriptionRetrySchedule(retry);
          const stream = (yield* watchBlocks(publicClientService, watchParams)).pipe(
            Stream.onStart(SubscriptionRef.set(stateRef, { status: "connected" })),
            Stream.tapError((error) =>
              SubscriptionRef.set(stateRef, { error, status: "retrying" })
            ),
            Stream.retry(schedule),
            Stream.catch(() => neverStream<Block>())
          );

          return { stateRef, stream };
        }),

      watchLogs: (params) => watchLogs(publicClientService, params),

      watchLogsRetrying: (params) =>
        Effect.gen(function* () {
          const stateRef = yield* SubscriptionRef.make<SubscriptionConnectionState>({
            status: "connecting",
          });

          const { retry, ...watchParams } = params;
          const schedule = makeSubscriptionRetrySchedule(retry);
          const stream = (yield* watchLogs(publicClientService, watchParams)).pipe(
            Stream.onStart(SubscriptionRef.set(stateRef, { status: "connected" })),
            Stream.tapError((error) =>
              SubscriptionRef.set(stateRef, { error, status: "retrying" })
            ),
            Stream.retry(schedule),
            Stream.catch(() => neverStream<Log>())
          );

          return { stateRef, stream };
        }),

      watchPendingTxs: (params) => watchPendingTxs(publicClientService, params),

      watchPendingTxsRetrying: (params) =>
        Effect.gen(function* () {
          const stateRef = yield* SubscriptionRef.make<SubscriptionConnectionState>({
            status: "connecting",
          });

          const { retry, ...watchParams } = params;
          const schedule = makeSubscriptionRetrySchedule(retry);
          const stream = (yield* watchPendingTxs(publicClientService, watchParams)).pipe(
            Stream.onStart(SubscriptionRef.set(stateRef, { status: "connected" })),
            Stream.tapError((error) =>
              SubscriptionRef.set(stateRef, { error, status: "retrying" })
            ),
            Stream.retry(schedule),
            Stream.catch(() => neverStream<Hash>())
          );

          return { stateRef, stream };
        }),
    };
  })
);
