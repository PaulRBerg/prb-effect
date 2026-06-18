import { Context, Effect, Layer, Ref, Stream } from "effect";
import type { Abi } from "viem";
import type { ClientNotFoundError, EventWatchError } from "#src/core/index.js";
import { EventBackfillError, PublicClientService } from "#src/core/index.js";
import type { BackfillParams, DecodedEvent, WatchParams } from "#src/events/index.js";
import { EventBackfill, EventStream } from "#src/events/index.js";
import type { StorageError } from "#src/platform/browser/storage/index.js";
import { makeRetrySchedule } from "#src/rpc/index.js";
import type { ContractEventName } from "#src/types/index.js";

export type StreamCursor = {
  chainId: number;
  address: string;
  eventName: string;
  lastBlockNumber: bigint;
  lastLogIndex: number;
  updatedAt: number;
};

/**
 * Union type of all cursor store errors.
 * Currently delegates to StorageError from browser storage.
 */
export type CursorStoreError = StorageError;

export type CursorStorage = {
  readonly get: (key: string) => Effect.Effect<StreamCursor | null, CursorStoreError>;
  readonly set: (key: string, cursor: StreamCursor) => Effect.Effect<void, CursorStoreError>;
  readonly delete: (key: string) => Effect.Effect<void, CursorStoreError>;
};

export class CursorStore extends Context.Tag("ew3/CursorStore")<CursorStore, CursorStorage>() {}

export const InMemoryCursorStoreLive = Layer.effect(
  CursorStore,
  Effect.gen(function* () {
    const store = yield* Ref.make(new Map<string, StreamCursor>());

    return CursorStore.of({
      delete: (key: string) =>
        Effect.gen(function* () {
          yield* Ref.update(store, (map) => {
            const newMap = new Map(map);
            newMap.delete(key);
            return newMap;
          });
        }).pipe(Effect.asVoid),
      get: (key: string) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(store);
          return map.get(key) ?? null;
        }),

      set: (key: string, cursor: StreamCursor) =>
        Effect.gen(function* () {
          yield* Ref.update(store, (map) => {
            const newMap = new Map(map);
            newMap.set(key, cursor);
            return newMap;
          });
        }).pipe(Effect.asVoid),
    });
  })
);

export const makeCursorKey = (chainId: number, address: string, eventName: string): string =>
  `${chainId}:${address.toLowerCase()}:${eventName}`;

export type CursorStreamShape = {
  /**
   * Watch events with automatic cursor tracking.
   * Resumes from the last cursor position if one exists.
   *
   * @remarks
   * Resume is inclusive of the cursor's block: the watch restarts from
   * `lastBlockNumber` (not `+1`) and events at or before
   * `(lastBlockNumber, lastLogIndex)` are filtered out, so events later in the
   * same block as the last-processed one are replayed exactly once after a
   * restart rather than being skipped.
   *
   * The cursor advances inside `Stream.tap`, i.e. *before* the consumer
   * processes the element. The cursor therefore marks **delivery, not
   * processing**: a crash mid-processing drops that event on the next resume.
   * Consumers must be idempotent.
   */
  readonly watchWithCursor: <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
    params: WatchParams<TAbi, TEventName> & { cursorKey: string }
  ) => Effect.Effect<
    Stream.Stream<DecodedEvent<TAbi, TEventName>, EventWatchError | StorageError>,
    ClientNotFoundError | StorageError
  >;

  /**
   * Backfill + watch with cursor.
   * First backfills from the cursor position up to a resolved head block, then
   * switches to a live watch starting at `head + 1` so there is no gap between
   * the two phases.
   *
   * @remarks
   * Same inclusive-resume and "cursor marks delivery, not processing"
   * semantics as {@link watchWithCursor}; consumers must be idempotent.
   */
  readonly syncWithCursor: <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
    params: BackfillParams<TAbi, TEventName> & { cursorKey: string }
  ) => Effect.Effect<
    Stream.Stream<
      DecodedEvent<TAbi, TEventName>,
      EventWatchError | EventBackfillError | StorageError
    >,
    ClientNotFoundError | EventBackfillError | StorageError
  >;
};

export class CursorStream extends Context.Tag("ew3/CursorStream")<
  CursorStream,
  CursorStreamShape
>() {}

export const CursorStreamLive = Layer.effect(
  CursorStream,
  Effect.gen(function* () {
    const cursorStore = yield* CursorStore;
    const eventStream = yield* EventStream;
    const eventBackfill = yield* EventBackfill;
    const publicClientService = yield* PublicClientService;

    // Advance the cursor to an event's position. Runs in `Stream.tap`, i.e.
    // before the consumer sees the element — the cursor marks delivery, not
    // processing, so consumers must be idempotent.
    const advanceCursor = (
      params: { address?: string; chainId: number; eventName: string; cursorKey: string },
      event: Pick<DecodedEvent, "blockNumber" | "logIndex">
    ) =>
      cursorStore.set(params.cursorKey, {
        address: params.address?.toLowerCase() ?? "",
        chainId: params.chainId,
        eventName: params.eventName,
        lastBlockNumber: event.blockNumber,
        lastLogIndex: event.logIndex,
        updatedAt: Date.now(),
      });

    // Drop events at or before the cursor position. Resume is inclusive of the
    // cursor block, so this evicts only the events already delivered while
    // replaying any later events in the same block exactly once.
    const isAfterCursor = (
      cursor: StreamCursor | null,
      event: Pick<DecodedEvent, "blockNumber" | "logIndex">
    ): boolean => {
      if (cursor == null) {
        return true;
      }
      if (event.blockNumber !== cursor.lastBlockNumber) {
        return event.blockNumber > cursor.lastBlockNumber;
      }
      return event.logIndex > cursor.lastLogIndex;
    };

    const watchWithCursor = <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
      params: WatchParams<TAbi, TEventName> & { cursorKey: string }
    ) =>
      Effect.gen(function* () {
        // Resume inclusively from the cursor block (not +1) and filter out the
        // already-delivered events; a `0n` cursor is honored via `!= null`.
        const cursor = yield* cursorStore.get(params.cursorKey);
        const fromBlock = cursor == null ? params.fromBlock : cursor.lastBlockNumber;

        const stream = yield* eventStream.watch({
          ...params,
          fromBlock,
        });

        return stream.pipe(
          Stream.filter((event) => isAfterCursor(cursor, event)),
          Stream.tap((event) => advanceCursor(params, event))
        );
      });

    const syncWithCursor = <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
      params: BackfillParams<TAbi, TEventName> & { cursorKey: string }
    ) =>
      Effect.gen(function* () {
        // Resume inclusively from the cursor block (not +1); `0n` honored.
        const cursor = yield* cursorStore.get(params.cursorKey);
        const fromBlock = cursor == null ? params.fromBlock : cursor.lastBlockNumber;

        // Resolve an explicit head block so backfill and live watch share a
        // single boundary: backfill ends at `head`, the live watch starts at
        // `head + 1`. Without this, backfill would internally end at "current
        // head" while the watch started at "now" — dropping events in between.
        const client = yield* publicClientService.get(params.chainId);
        const head =
          params.toBlock ??
          (yield* Effect.tryPromise({
            catch: (cause) => cause,
            try: () => client.getBlockNumber(),
          }).pipe(
            Effect.retry(makeRetrySchedule()),
            Effect.mapError(
              (cause) =>
                new EventBackfillError({
                  cause,
                  chainId: params.chainId,
                  message: `Failed to resolve head block on chain ${params.chainId}`,
                })
            )
          ));

        // Backfill stream with cursor updates, bounded at the resolved head.
        const backfillStream = yield* eventBackfill.fetch({
          ...params,
          fromBlock,
          toBlock: head,
        });

        const backfillWithCursor = backfillStream.pipe(
          Stream.filter((event) => isAfterCursor(cursor, event)),
          Stream.tap((event) => advanceCursor(params, event))
        );

        // Live watch stream starting just past the backfill boundary.
        const watchStream = yield* eventStream.watch({
          abi: params.abi,
          address: params.address,
          chainId: params.chainId,
          eventName: params.eventName,
          fromBlock: head + 1n,
        });

        // The filter also applies here: a cursor persisted against a node that was
        // ahead of this node's head (`cursor.lastBlockNumber > head`) would otherwise
        // replay already-delivered events through the live watch.
        const watchStreamWithCursor = watchStream.pipe(
          Stream.filter((event) => isAfterCursor(cursor, event)),
          Stream.tap((event) => advanceCursor(params, event))
        );

        // Concatenate backfill and watch streams
        return Stream.concat(backfillWithCursor, watchStreamWithCursor);
      });

    return { syncWithCursor, watchWithCursor };
  })
);
