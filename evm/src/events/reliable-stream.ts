import { Cause, Context, Effect, Fiber, Layer, Ref, Schedule, Stream } from "effect";
import type { Abi, Address, Hash } from "viem";
import { DEFAULT_POLLING_INTERVAL } from "#src/constants/index.js";
import type { ClientNotFoundError } from "#src/core/index.js";
import { EventWatchError, PublicClientService } from "#src/core/index.js";
import type { DecodedEvent } from "#src/events/index.js";
import { EventStream } from "#src/events/index.js";
import { makeRetrySchedule } from "#src/rpc/index.js";
import type { ContractEventName } from "#src/types/index.js";

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
   * Watch for events with reorg safety.
   *
   * Events are only emitted after reaching the confirmation threshold, and
   * reorged events are filtered out before emission.
   *
   * @remarks
   * Reorg filtering relies on `removed: true` log notifications, which **only
   * WebSocket subscriptions deliver**. With HTTP polling a reorged-out event is
   * still emitted once the height threshold passes — there is no `removed`
   * notification to evict it from the pending set.
   *
   * `confirmations` here means "N blocks **after** the event block": with
   * `confirmations: 1`, an event in block `B` is emitted once the head reaches
   * `B + 1`. Note this differs from viem's `getTransactionConfirmations`
   * convention, which would call that same situation "2 confirmations".
   *
   * If the base event stream fails, or the confirmation poller fails terminally
   * (after retries), the output stream fails with an {@link EventWatchError} so
   * consumers observe the error instead of hanging on a silently-dead fiber.
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

            // Map any terminal failure/defect from a background fiber into the
            // stream's error channel so consumers observe it instead of hanging.
            // Interruption (normal stream shutdown) is intentionally ignored — it
            // must not surface as a spurious failure.
            const failStream = (cause: Cause.Cause<unknown>) =>
              Effect.sync(() => {
                if (Cause.isInterruptedOnly(cause)) {
                  return;
                }
                emit.fail(
                  new EventWatchError({
                    cause: Cause.squash(cause),
                    chainId: params.chainId,
                    message: `Reliable event stream failed on chain ${params.chainId}`,
                  })
                );
              });

            // Process events from base stream. If `baseStream` fails, propagate
            // the error to the consumer rather than letting this fiber die silently.
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
              ).pipe(Effect.catchAllCause(failStream))
            );

            // Background task: check confirmations periodically. A single failed
            // `getBlockNumber` poll is retried, then swallowed as a warning so it
            // skips the tick instead of killing the loop. A terminal failure of the
            // repeat itself (a bug) is mapped onto the stream error channel.
            const checkInterval = params.pollingInterval ?? DEFAULT_POLLING_INTERVAL;
            const confirmationChecker = yield* Effect.fork(
              Effect.repeat(
                Effect.gen(function* () {
                  const currentBlock = yield* Effect.tryPromise({
                    catch: (cause) => cause,
                    try: () => client.getBlockNumber(),
                  }).pipe(
                    Effect.retry(makeRetrySchedule()),
                    Effect.catchAll((cause) =>
                      Effect.logWarning(
                        `Confirmation poll failed on chain ${params.chainId}; skipping tick`,
                        cause
                      ).pipe(Effect.as(undefined))
                    )
                  );
                  // A skipped tick yields `undefined`; only re-check confirmations
                  // when we actually fetched a fresh head block.
                  if (currentBlock !== undefined) {
                    yield* emitConfirmedEvents(currentBlock);
                  }
                }),
                Schedule.spaced(`${checkInterval} millis`)
              ).pipe(Effect.catchAllCause(failStream))
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
