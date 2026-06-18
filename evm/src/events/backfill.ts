import { Array as Arr, Context, Effect, Layer, Stream } from "effect";
import type { Abi, AbiEvent, Address } from "viem";
import type { ClientNotFoundError } from "#src/core/index.js";
import { EventBackfillError, PublicClientService } from "#src/core/index.js";
import type { DecodedEvent } from "#src/events/index.js";
import { tryDecodeLog } from "#src/events/index.js";
import { makeRetrySchedule } from "#src/rpc/index.js";
import type { ContractEventName } from "#src/types/index.js";

export type BackfillParams<TAbi extends Abi, TEventName extends ContractEventName<TAbi>> = {
  chainId: number;
  address?: Address;
  abi: TAbi;
  eventName: TEventName;
  fromBlock: bigint;
  toBlock?: bigint;
  batchSize?: bigint;
};

export type EventBackfillShape = {
  /**
   * Fetch historical events as a Stream
   * Fetches in batches to avoid RPC limits
   *
   * RPC failures (rate limits, timeouts) are retried with backoff; a permanent
   * failure surfaces as a tagged `EventBackfillError` instead of an unrecoverable
   * defect. The head-block lookup (only performed when `toBlock` is undefined)
   * runs before the stream is constructed, so its failure lands on the outer
   * `Effect` error channel.
   */
  readonly fetch: <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
    params: BackfillParams<TAbi, TEventName>
  ) => Effect.Effect<
    Stream.Stream<DecodedEvent<TAbi, TEventName>, EventBackfillError>,
    ClientNotFoundError | EventBackfillError
  >;

  /**
   * Fetch all historical events and return as array
   */
  readonly fetchAll: <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
    params: BackfillParams<TAbi, TEventName>
  ) => Effect.Effect<DecodedEvent<TAbi, TEventName>[], ClientNotFoundError | EventBackfillError>;
};

export class EventBackfill extends Context.Tag("ew3/EventBackfill")<
  EventBackfill,
  EventBackfillShape
>() {}

/**
 * Run an RPC call, retrying transient failures with backoff. The raw rejection
 * is retried (it carries the rate-limit/timeout message the retry schedule
 * matches on); only a terminal failure is mapped to a tagged `EventBackfillError`.
 */
function rpcWithRetry<A>(params: {
  chainId: number;
  message: string;
  try: () => Promise<A>;
}): Effect.Effect<A, EventBackfillError> {
  return Effect.tryPromise({ try: params.try, catch: (cause) => cause }).pipe(
    Effect.retry(makeRetrySchedule()),
    Effect.mapError(
      (cause) => new EventBackfillError({ cause, chainId: params.chainId, message: params.message })
    )
  );
}

export const EventBackfillLive = Layer.effect(
  EventBackfill,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;

    const fetch = <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
      params: BackfillParams<TAbi, TEventName>
    ) =>
      Effect.gen(function* () {
        const client = yield* publicClientService.get(params.chainId);
        const batchSize = params.batchSize ?? 2000n;

        // Resolve the end of the range. Only hit the RPC when the caller did not
        // supply `toBlock` — running it unconditionally adds a needless failure point.
        const toBlock =
          params.toBlock ??
          (yield* rpcWithRetry({
            chainId: params.chainId,
            message: `Failed to resolve head block on chain ${params.chainId}`,
            try: () => client.getBlockNumber(),
          }));

        // Create batches: [fromBlock, fromBlock+batchSize], etc.
        const batches: Array<{ from: bigint; to: bigint }> = [];
        let currentFrom = params.fromBlock;

        while (currentFrom <= toBlock) {
          const currentTo =
            currentFrom + batchSize - 1n > toBlock ? toBlock : currentFrom + batchSize - 1n;
          batches.push({ from: currentFrom, to: currentTo });
          currentFrom = currentTo + 1n;
        }

        return Stream.fromIterable(batches).pipe(
          Stream.mapEffect((batch) =>
            Effect.gen(function* () {
              const logs = yield* rpcWithRetry({
                chainId: params.chainId,
                message: `Failed to fetch logs for blocks ${batch.from}-${batch.to} on chain ${params.chainId}`,
                try: () =>
                  client.getLogs({
                    address: params.address,
                    event: params.abi.find(
                      (item): item is AbiEvent =>
                        item.type === "event" && item.name === params.eventName
                    ),
                    fromBlock: batch.from,
                    toBlock: batch.to,
                  }),
              });

              // Decode logs and filter out failed decodes
              return Arr.getSomes(logs.map((log) => tryDecodeLog(log, params.abi))).filter(
                (e): e is DecodedEvent<TAbi, TEventName> => e.eventName === params.eventName
              );
            })
          ),
          Stream.flatMap((events) => Stream.fromIterable(events))
        );
      });

    const fetchAll = <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
      params: BackfillParams<TAbi, TEventName>
    ) =>
      Effect.gen(function* () {
        const stream = yield* fetch(params);
        return yield* Stream.runCollect(stream).pipe(Effect.map((chunk) => Array.from(chunk)));
      });

    return { fetch, fetchAll };
  })
);
