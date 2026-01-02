import { Context, Effect, Layer, Ref, Stream } from "effect";
import type { Abi } from "viem";
import type { ClientNotFoundError, EventWatchError } from "@/src/core/index.js";
import type { BackfillParams, DecodedEvent, WatchParams } from "@/src/events/index.js";
import { EventBackfill, EventStream } from "@/src/events/index.js";
import type { StorageError } from "@/src/platform/browser/storage/index.js";
import type { ContractEventName } from "@/src/types/index.js";

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
   * Watch events with automatic cursor tracking
   * Resumes from last position if cursor exists
   */
  readonly watchWithCursor: <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
    params: WatchParams<TAbi, TEventName> & { cursorKey: string }
  ) => Effect.Effect<
    Stream.Stream<DecodedEvent<TAbi, TEventName>, EventWatchError | StorageError>,
    ClientNotFoundError | StorageError
  >;

  /**
   * Backfill + watch with cursor
   * First backfills from cursor position, then switches to live
   */
  readonly syncWithCursor: <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
    params: BackfillParams<TAbi, TEventName> & { cursorKey: string }
  ) => Effect.Effect<
    Stream.Stream<DecodedEvent<TAbi, TEventName>, EventWatchError | StorageError>,
    ClientNotFoundError | StorageError
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

    const watchWithCursor = <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
      params: WatchParams<TAbi, TEventName> & { cursorKey: string }
    ) =>
      Effect.gen(function* () {
        // Get cursor to determine fromBlock
        const cursor = yield* cursorStore.get(params.cursorKey);
        const fromBlock = cursor?.lastBlockNumber ? cursor.lastBlockNumber + 1n : params.fromBlock;

        // Create watch stream
        const stream = yield* eventStream.watch({
          ...params,
          fromBlock,
        });

        // Wrap stream to update cursor on each event
        return stream.pipe(
          Stream.tap((event) =>
            cursorStore.set(params.cursorKey, {
              address: params.address?.toLowerCase() ?? "",
              chainId: params.chainId,
              eventName: params.eventName,
              lastBlockNumber: event.blockNumber,
              lastLogIndex: event.logIndex,
              updatedAt: Date.now(),
            })
          )
        );
      });

    const syncWithCursor = <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
      params: BackfillParams<TAbi, TEventName> & { cursorKey: string }
    ) =>
      Effect.gen(function* () {
        // Get cursor to determine fromBlock
        const cursor = yield* cursorStore.get(params.cursorKey);
        const fromBlock = cursor?.lastBlockNumber ? cursor.lastBlockNumber + 1n : params.fromBlock;

        // Backfill stream with cursor updates
        const backfillStream = yield* eventBackfill.fetch({
          ...params,
          fromBlock,
        });

        const backfillWithCursor = backfillStream.pipe(
          Stream.tap((decodedEvent) =>
            cursorStore.set(params.cursorKey, {
              address: params.address?.toLowerCase() ?? "",
              chainId: params.chainId,
              eventName: params.eventName,
              lastBlockNumber: decodedEvent.blockNumber,
              lastLogIndex: decodedEvent.logIndex,
              updatedAt: Date.now(),
            })
          )
        );

        // Live watch stream with cursor updates
        const watchStream = yield* eventStream.watch({
          abi: params.abi,
          address: params.address,
          chainId: params.chainId,
          eventName: params.eventName,
          fromBlock: params.toBlock ? params.toBlock + 1n : undefined,
        });

        const watchStreamWithCursor = watchStream.pipe(
          Stream.tap((decodedEvent) =>
            cursorStore.set(params.cursorKey, {
              address: params.address?.toLowerCase() ?? "",
              chainId: params.chainId,
              eventName: params.eventName,
              lastBlockNumber: decodedEvent.blockNumber,
              lastLogIndex: decodedEvent.logIndex,
              updatedAt: Date.now(),
            })
          )
        );

        // Concatenate backfill and watch streams
        return Stream.concat(backfillWithCursor, watchStreamWithCursor);
      });

    return { syncWithCursor, watchWithCursor };
  })
);
