import { Context, Effect, Layer, Stream } from "effect";
import type { Block } from "viem";
import type { ClientNotFoundError, TransportError } from "#src/core/index.js";
import { PublicClientService, TransportError as TransportErrorClass } from "#src/core/index.js";
import { SubscriptionService } from "#src/subscriptions/index.js";
import { SpanNames } from "#src/telemetry/index.js";

export type ChainHeadShape = {
  readonly current: (
    chainId: number
  ) => Effect.Effect<bigint, ClientNotFoundError | TransportError>;

  readonly watch: (
    chainId: number
  ) => Effect.Effect<Stream.Stream<bigint, never>, ClientNotFoundError>;
};

export class ChainHead extends Context.Service<ChainHead, ChainHeadShape>()("ew3/ChainHead") {}

export const ChainHeadLive = Layer.effect(
  ChainHead,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;
    const subscriptionService = yield* SubscriptionService;

    return ChainHead.of({
      current: (chainId) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(chainId);

          return yield* Effect.tryPromise({
            catch: (cause) =>
              new TransportErrorClass({
                cause,
                message: `Failed to get current block number (chainId=${chainId})`,
                url: client.transport.url ?? "unknown",
              }),
            try: () => client.getBlockNumber(),
          });
        }).pipe(
          Effect.withSpan(SpanNames.BLOCK_GET_NUMBER, {
            attributes: { chainId },
          })
        ),

      watch: (chainId) =>
        Effect.gen(function* () {
          const { stream } = yield* subscriptionService.watchBlocksRetrying({
            chainId,
          });

          return stream.pipe(
            Stream.map((block: Block) => block.number),
            Stream.filter((n): n is bigint => n !== null && n !== undefined)
          );
        }).pipe(
          Effect.withSpan(SpanNames.BLOCK_WATCH, {
            attributes: { chainId },
          })
        ),
    });
  })
);
