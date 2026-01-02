import { Array as Arr, Context, Effect, Layer, Stream } from "effect";
import type { Abi, AbiEvent, Address } from "viem";
import type { ClientNotFoundError } from "@/src/core/index.js";
import { PublicClientService } from "@/src/core/index.js";
import type { DecodedEvent } from "@/src/events/index.js";
import { tryDecodeLog } from "@/src/events/index.js";
import type { ContractEventName } from "@/src/types/index.js";

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
   */
  readonly fetch: <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
    params: BackfillParams<TAbi, TEventName>
  ) => Effect.Effect<Stream.Stream<DecodedEvent<TAbi, TEventName>, never>, ClientNotFoundError>;

  /**
   * Fetch all historical events and return as array
   */
  readonly fetchAll: <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
    params: BackfillParams<TAbi, TEventName>
  ) => Effect.Effect<DecodedEvent<TAbi, TEventName>[], ClientNotFoundError>;
};

export class EventBackfill extends Context.Tag("ew3/EventBackfill")<
  EventBackfill,
  EventBackfillShape
>() {}

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

        // Get current block if toBlock not specified
        const currentBlock = yield* Effect.promise(() => client.getBlockNumber());
        const toBlock = params.toBlock ?? currentBlock;

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
              // Call client.getLogs for this batch
              const logs = yield* Effect.promise(() =>
                client.getLogs({
                  address: params.address,
                  event: params.abi.find(
                    (item): item is AbiEvent =>
                      item.type === "event" && item.name === params.eventName
                  ),
                  fromBlock: batch.from,
                  toBlock: batch.to,
                })
              );

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
