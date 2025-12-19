import { Context, Effect, Fiber, Layer, Ref, Schedule, Stream } from "effect";
import type { Abi, Address, Hash } from "viem";
import { DEFAULT_POLLING_INTERVAL } from "@/src/constants/index.js";
import type { ClientNotFoundError, EventWatchError } from "@/src/core/index.js";
import { PublicClientService } from "@/src/core/index.js";
import type { DecodedEvent } from "@/src/events/index.js";
import { EventStream } from "@/src/events/index.js";
import type { ContractEventName } from "@/src/types/index.js";

export type ReliableWatchParams<TAbi extends Abi, TEventName extends ContractEventName<TAbi>> = {
  chainId: number;
  address?: Address;
  abi: TAbi;
  eventName: TEventName;
  fromBlock?: bigint;
  pollingInterval?: number;
  confirmations?: number;
};

type PendingEvent<TAbi extends Abi, TEventName extends string> = {
  event: DecodedEvent<TAbi, TEventName>;
  receivedAt: number;
};

type EventKey = {
  txHash: Hash;
  logIndex: number;
};

type ReliableState<TAbi extends Abi, TEventName extends string> = {
  readonly pendingByBlock: Map<bigint, PendingEvent<TAbi, TEventName>[]>;
  readonly locationByKey: Map<string, bigint>;
};

export type ReliableEventStreamShape = {
  /**
   * Watch for events with reorg safety
   * Events are only emitted after reaching the confirmation threshold
   * Reorged events are filtered out
   */
  readonly watch: <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
    params: ReliableWatchParams<TAbi, TEventName>
  ) => Effect.Effect<
    Stream.Stream<DecodedEvent<TAbi, TEventName>, EventWatchError>,
    ClientNotFoundError
  >;
};

export class ReliableEventStream extends Context.Tag("ew3/ReliableEventStream")<
  ReliableEventStream,
  ReliableEventStreamShape
>() {}

export const ReliableEventStreamLive = Layer.effect(
  ReliableEventStream,
  Effect.gen(function* () {
    const eventStream = yield* EventStream;
    const publicClientService = yield* PublicClientService;

    return {
      watch: Effect.fn("ReliableEventStream.watch")(function* <
        TAbi extends Abi,
        TEventName extends ContractEventName<TAbi>,
      >(params: ReliableWatchParams<TAbi, TEventName>) {
        const confirmations = params.confirmations ?? 1;
        const client = yield* publicClientService.get(params.chainId);

        // Get base event stream
        const baseStream = yield* eventStream.watch(params);

        return Stream.asyncScoped<DecodedEvent<TAbi, TEventName>, EventWatchError>((emit) =>
          Effect.gen(function* () {
            // State: map blockNumber -> array of pending events
            const stateRef = yield* Ref.make<ReliableState<TAbi, TEventName>>({
              locationByKey: new Map<string, bigint>(/* key format: "txHash-logIndex" */),
              pendingByBlock: new Map<bigint, PendingEvent<TAbi, TEventName>[]>(),
            });

            // Helper: serialize event key for map lookup
            const serializeKey = (key: EventKey): string => `${key.txHash}-${key.logIndex}`;

            const addEventLocations = (
              map: Map<string, bigint>,
              blockNumber: bigint,
              events: readonly PendingEvent<TAbi, TEventName>[]
            ) => {
              for (const pending of events) {
                const key = serializeKey({
                  logIndex: pending.event.logIndex,
                  txHash: pending.event.transactionHash,
                });
                map.set(key, blockNumber);
              }
            };

            // Helper: emit confirmed events and clean up
            const emitConfirmedEvents = (currentBlock: bigint) =>
              Ref.modify(stateRef, (state) => {
                const confirmed: PendingEvent<TAbi, TEventName>[] = [];
                const remainingPending = new Map<bigint, PendingEvent<TAbi, TEventName>[]>();
                const remainingLocations = new Map<string, bigint>();

                for (const [blockNumber, events] of state.pendingByBlock.entries()) {
                  const confirmationsReceived = currentBlock - blockNumber;
                  if (confirmationsReceived >= BigInt(confirmations)) {
                    confirmed.push(...events);
                    continue;
                  }

                  remainingPending.set(blockNumber, events);
                  addEventLocations(remainingLocations, blockNumber, events);
                }

                return [
                  confirmed,
                  {
                    locationByKey: remainingLocations,
                    pendingByBlock: remainingPending,
                  },
                ] as const;
              }).pipe(
                Effect.flatMap((confirmed) =>
                  Effect.sync(() => {
                    for (const pending of confirmed) {
                      emit.single(pending.event);
                    }
                  })
                )
              );

            // Helper: add new event to pending
            const addPendingEvent = (event: DecodedEvent<TAbi, TEventName>) =>
              Ref.update(stateRef, (state) => {
                const blockNumber = event.blockNumber;
                const key = serializeKey({
                  logIndex: event.logIndex,
                  txHash: event.transactionHash,
                });
                const pending: PendingEvent<TAbi, TEventName> = {
                  event,
                  receivedAt: Date.now(),
                };

                const pendingByBlock = new Map(state.pendingByBlock);
                const existing = pendingByBlock.get(blockNumber) ?? [];
                pendingByBlock.set(blockNumber, [...existing, pending]);

                const locationByKey = new Map(state.locationByKey);
                locationByKey.set(key, blockNumber);

                return { locationByKey, pendingByBlock };
              });

            // Helper: remove reorged event
            const removeReorgedEvent = (event: DecodedEvent<TAbi, TEventName>) =>
              Ref.update(stateRef, (state) => {
                const key = serializeKey({
                  logIndex: event.logIndex,
                  txHash: event.transactionHash,
                });

                const blockNumber = state.locationByKey.get(key);
                if (blockNumber === undefined) {
                  return state;
                }

                const pendingByBlock = new Map(state.pendingByBlock);
                const events = pendingByBlock.get(blockNumber);
                if (!events) {
                  const locationByKey = new Map(state.locationByKey);
                  locationByKey.delete(key);
                  return { locationByKey, pendingByBlock };
                }

                const filtered = events.filter(
                  (p) =>
                    p.event.transactionHash !== event.transactionHash ||
                    p.event.logIndex !== event.logIndex
                );

                if (filtered.length === 0) {
                  pendingByBlock.delete(blockNumber);
                } else {
                  pendingByBlock.set(blockNumber, filtered);
                }

                const locationByKey = new Map(state.locationByKey);
                locationByKey.delete(key);
                return { locationByKey, pendingByBlock };
              });

            // Process events from base stream
            const processEvents = yield* Effect.fork(
              Stream.runForEach(baseStream, (event) =>
                Effect.gen(function* () {
                  if (event.removed) {
                    // Handle reorg: remove from pending
                    yield* removeReorgedEvent(event);
                  } else {
                    // Add to pending
                    yield* addPendingEvent(event);
                  }
                })
              )
            );

            // Background task: check confirmations periodically
            const checkInterval = params.pollingInterval ?? DEFAULT_POLLING_INTERVAL;
            const confirmationChecker = yield* Effect.fork(
              Effect.repeat(
                Effect.gen(function* () {
                  const currentBlock = yield* Effect.tryPromise(() => client.getBlockNumber());
                  yield* emitConfirmedEvents(currentBlock);
                }),
                Schedule.spaced(`${checkInterval} millis`)
              )
            );

            // Clean up on stream end
            return Effect.gen(function* () {
              yield* Fiber.interrupt(processEvents);
              yield* Fiber.interrupt(confirmationChecker);
            });
          })
        );
      }),
    };
  })
);
