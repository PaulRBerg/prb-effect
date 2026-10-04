import { Context, Effect, Layer } from "effect";
import type { Address } from "viem";
import type { ClientNotFoundError } from "#src/core/errors/index.js";
import { PublicClientService, TransportError } from "#src/core/index.js";
import { makeNonceManager } from "#src/nonce/manager.js";
import { SpanNames } from "#src/telemetry/index.js";

export type NonceServiceShape = {
  readonly getNext: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  readonly reserve: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  readonly release: (params: {
    address: Address;
    chainId: number;
    nonce: bigint;
  }) => Effect.Effect<void, never>;

  readonly confirm: (params: {
    address: Address;
    chainId: number;
    nonce: bigint;
  }) => Effect.Effect<void, never>;

  readonly getPendingCount: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  readonly getConfirmedCount: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  readonly getGaps: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint[], ClientNotFoundError>;

  readonly sync: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;
};

export class NonceService extends Context.Service<NonceService, NonceServiceShape>()(
  "ew3/NonceService"
) {}

export const NonceServiceLive = Layer.effect(
  NonceService,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;
    const manager = yield* makeNonceManager();

    return NonceService.of({
      confirm: (params: { chainId: number; address: Address; nonce: bigint }) =>
        manager.confirm(params.chainId, params.address, params.nonce).pipe(
          Effect.withSpan(SpanNames.NONCE_CONFIRM, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              nonce: params.nonce.toString(),
            },
          })
        ),

      getConfirmedCount: (params: { chainId: number; address: Address }) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);
          const count = yield* Effect.tryPromise({
            catch: (cause) =>
              new TransportError({
                cause,
                message: `Failed to get confirmed nonce count (chainId=${params.chainId}, address=${params.address})`,
                url: client.transport.url ?? "unknown",
              }),
            try: () =>
              client.getTransactionCount({
                address: params.address,
                blockTag: "latest",
              }),
          });
          return BigInt(count);
        }).pipe(
          Effect.withSpan(SpanNames.NONCE_GET_CONFIRMED_COUNT, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
            },
          })
        ),

      getGaps: (params: { chainId: number; address: Address }) =>
        manager.getGaps(params.chainId, params.address).pipe(
          Effect.withSpan(SpanNames.NONCE_GET_GAPS, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
            },
          })
        ),
      getNext: (params: { chainId: number; address: Address }) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);
          const [onChainPending, cachedConfirmed] = yield* Effect.all(
            [
              Effect.tryPromise({
                catch: (cause) =>
                  new TransportError({
                    cause,
                    message: `Failed to get pending nonce count (chainId=${params.chainId}, address=${params.address})`,
                    url: client.transport.url ?? "unknown",
                  }),
                try: () =>
                  client.getTransactionCount({
                    address: params.address,
                    blockTag: "pending",
                  }),
              }),
              manager.getConfirmed(params.chainId, params.address),
            ],
            { concurrency: 2 }
          );

          const pending = BigInt(onChainPending);
          return cachedConfirmed && cachedConfirmed > pending ? cachedConfirmed : pending;
        }).pipe(
          Effect.withSpan(SpanNames.NONCE_GET_NEXT, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
            },
          })
        ),

      getPendingCount: (params: { chainId: number; address: Address }) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);
          const count = yield* Effect.tryPromise({
            catch: (cause) =>
              new TransportError({
                cause,
                message: `Failed to get pending nonce count (chainId=${params.chainId}, address=${params.address})`,
                url: client.transport.url ?? "unknown",
              }),
            try: () =>
              client.getTransactionCount({
                address: params.address,
                blockTag: "pending",
              }),
          });
          return BigInt(count);
        }).pipe(
          Effect.withSpan(SpanNames.NONCE_GET_PENDING_COUNT, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
            },
          })
        ),

      release: (params: { chainId: number; address: Address; nonce: bigint }) =>
        manager.release(params.chainId, params.address, params.nonce).pipe(
          Effect.withSpan(SpanNames.NONCE_RELEASE, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              nonce: params.nonce.toString(),
            },
          })
        ),

      reserve: (params: { chainId: number; address: Address }) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);
          const onChainPending = yield* Effect.tryPromise({
            catch: (cause) =>
              new TransportError({
                cause,
                message: `Failed to get pending nonce count (chainId=${params.chainId}, address=${params.address})`,
                url: client.transport.url ?? "unknown",
              }),
            try: () =>
              client.getTransactionCount({
                address: params.address,
                blockTag: "pending",
              }),
          });

          return yield* manager.reserveNext(params.chainId, params.address, BigInt(onChainPending));
        }).pipe(
          Effect.withSpan(SpanNames.NONCE_RESERVE, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
            },
          })
        ),

      sync: (params: { chainId: number; address: Address }) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);
          const count = yield* Effect.tryPromise({
            catch: (cause) =>
              new TransportError({
                cause,
                message: `Failed to sync confirmed nonce count (chainId=${params.chainId}, address=${params.address})`,
                url: client.transport.url ?? "unknown",
              }),
            try: () =>
              client.getTransactionCount({
                address: params.address,
                blockTag: "latest",
              }),
          });
          const latest = BigInt(count);
          yield* manager.setConfirmed(params.chainId, params.address, latest);
          return latest;
        }).pipe(
          Effect.withSpan(SpanNames.NONCE_SYNC, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
            },
          })
        ),
    });
  })
);
