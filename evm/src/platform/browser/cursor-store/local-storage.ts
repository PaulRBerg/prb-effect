import { Effect, Layer, Ref } from "effect";
import { DEFAULT_CURSOR_FLUSH_DELAY } from "#src/constants/index.js";
import type { StreamCursor } from "#src/events/index.js";
import { CursorStore } from "#src/events/index.js";
import { BrowserStorage } from "#src/platform/browser/storage/index.js";

/**
 * Key format for cursor storage entries.
 * Format: ew3:v1:cursor:{cursorKey}
 */
const makeCursorStorageKey = (cursorKey: string): string => `ew3:v1:cursor:${cursorKey}`;

/**
 * Serialize a StreamCursor to JSON string.
 * Converts bigint lastBlockNumber to string for JSON compatibility.
 */
const serializeCursor = (cursor: StreamCursor): string =>
  JSON.stringify({
    address: cursor.address,
    chainId: cursor.chainId,
    eventName: cursor.eventName,
    lastBlockNumber: cursor.lastBlockNumber.toString(),
    lastLogIndex: cursor.lastLogIndex,
    updatedAt: cursor.updatedAt,
  });

/**
 * Deserialize a JSON string to StreamCursor.
 * Converts string lastBlockNumber back to bigint.
 */
const deserializeCursor = (json: string): StreamCursor => {
  const parsed = JSON.parse(json);
  return {
    address: parsed.address,
    chainId: parsed.chainId,
    eventName: parsed.eventName,
    lastBlockNumber: BigInt(parsed.lastBlockNumber),
    lastLogIndex: parsed.lastLogIndex,
    updatedAt: parsed.updatedAt,
  };
};

/**
 * Pending write slot for a key.
 *
 * A single map drives both the buffered cursor and the throttle scheduling so
 * that "take the pending write" and "is a flush already scheduled" are decided
 * atomically through `Ref.modify`. Splitting these into two Refs allowed a
 * delete/flush race to permanently wedge a key (flush cleared its pending write
 * but left a stale timer behind, so every later `set` short-circuited).
 *
 * `cursor` is `null` while a flush owns the key but has already drained the last
 * buffered value — the slot is retained so a concurrent `set` reuses the running
 * flush instead of forking a second one.
 *
 * `deleted` is a tombstone: `delete()` ran while a flush owned the key. A write
 * that raced the delete resurrected the key in storage, so the owning loop must
 * remove it again before releasing. A later `set()` overwrites the tombstone —
 * the most recent operation wins.
 */
type PendingSlot = {
  readonly cursor: StreamCursor | null;
  readonly deleted: boolean;
  readonly flushScheduled: boolean;
};

/** Outcome of an atomic slot inspection, telling the owning flush loop what to do. */
type FlushDirective =
  | { readonly _tag: "write"; readonly cursor: StreamCursor }
  | { readonly _tag: "continue" }
  | { readonly _tag: "release" }
  | { readonly _tag: "removeDeleted" };

/**
 * Live implementation of CursorStore using browser localStorage.
 *
 * Features:
 * - Stores cursors in localStorage with key prefix "ew3:v1:cursor:"
 * - Write throttling: buffers writes to max once per 250ms per key
 * - Automatic corruption handling: logs warning and deletes corrupt entries
 * - Depends on BrowserStorage service for low-level storage operations
 */
export const LocalStorageCursorStoreLive = Layer.effect(
  CursorStore,
  Effect.gen(function* () {
    const storage = yield* BrowserStorage;

    // Single source of truth: buffered cursor + whether a flush fiber owns it.
    const pending = yield* Ref.make(new Map<string, PendingSlot>());

    /**
     * Get cursor from storage.
     * On decode error: logs warning, deletes corrupt entry, returns null.
     */
    const get = (key: string) =>
      Effect.gen(function* () {
        const storageKey = makeCursorStorageKey(key);
        const value = yield* storage.get(storageKey);

        if (value === null) {
          return null;
        }

        try {
          return deserializeCursor(value);
        } catch {
          // Log warning about corrupt data
          yield* Effect.logWarning(`Corrupt cursor data for key "${key}", deleting entry`);

          // Delete corrupt entry
          yield* storage.remove(storageKey).pipe(Effect.catchAll(() => Effect.void));

          return null;
        }
      });

    /**
     * Atomically drain the slot after the throttle sleep. Honors a tombstone
     * first, releases an idle slot, or takes the buffered cursor for writing —
     * keeping ownership via `cursor: null` so a concurrent `set` reuses this
     * running flush rather than forking another.
     */
    const drainSlot = (key: string): Effect.Effect<FlushDirective> =>
      Ref.modify(pending, (map): readonly [FlushDirective, Map<string, PendingSlot>] => {
        const slot = map.get(key);
        if (slot === undefined) {
          return [{ _tag: "release" }, map];
        }
        if (slot.deleted) {
          const newMap = new Map(map);
          newMap.delete(key);
          return [{ _tag: "removeDeleted" }, newMap];
        }
        if (slot.cursor === null) {
          // Drained and idle — release ownership so the next set() re-arms a flush.
          const newMap = new Map(map);
          newMap.delete(key);
          return [{ _tag: "release" }, newMap];
        }
        const newMap = new Map(map);
        newMap.set(key, { cursor: null, deleted: false, flushScheduled: true });
        return [{ _tag: "write", cursor: slot.cursor }, newMap];
      });

    /**
     * Atomically decide what to do after a write. A `delete()` that landed while
     * the write was in flight left a tombstone — the write resurrected the key in
     * storage, so it must be removed again. A `set()` that landed left a fresh
     * cursor — keep ownership and loop. Otherwise release (slot removed) so the
     * next `set` re-arms a flush. Folding decision and release into one
     * `Ref.modify` closes the window where a late `set` could see
     * `flushScheduled: true`, skip forking, and then find no live loop.
     */
    const settleAfterWrite = (key: string): Effect.Effect<FlushDirective> =>
      Ref.modify(pending, (map): readonly [FlushDirective, Map<string, PendingSlot>] => {
        const slot = map.get(key);
        if (slot === undefined) {
          return [{ _tag: "release" }, map];
        }
        if (slot.deleted) {
          const newMap = new Map(map);
          newMap.delete(key);
          return [{ _tag: "removeDeleted" }, newMap];
        }
        if (slot.cursor !== null) {
          return [{ _tag: "continue" }, map];
        }
        const newMap = new Map(map);
        newMap.delete(key);
        return [{ _tag: "release" }, newMap];
      });

    /**
     * Flush loop for a key. Sleeps for the throttle window, drains the buffered
     * cursor, writes it, then re-checks whether a newer cursor (or a delete)
     * arrived during the sleep/write and handles that too. Ownership is released
     * via `ensuring` so a failed or interrupted write can never permanently wedge
     * the key.
     */
    const flushLoop = (key: string): Effect.Effect<void> => {
      const storageKey = makeCursorStorageKey(key);

      const logStorageFailure = (action: string) => (error: unknown) =>
        Effect.logWarning(`Failed to ${action} cursor for key "${key}"`).pipe(
          Effect.annotateLogs("error", String(error))
        );

      // Idempotent with delete()'s own storage.remove; needed when our write
      // landed after it.
      const removeDeleted = storage
        .remove(storageKey)
        .pipe(Effect.catchAll(logStorageFailure("remove deleted")));

      const step: Effect.Effect<boolean> = Effect.gen(function* () {
        yield* Effect.sleep(DEFAULT_CURSOR_FLUSH_DELAY);

        const directive = yield* drainSlot(key);
        if (directive._tag === "removeDeleted") {
          yield* removeDeleted;
          return false;
        }
        if (directive._tag !== "write") {
          return false;
        }

        yield* storage
          .set(storageKey, serializeCursor(directive.cursor))
          .pipe(Effect.catchAll(logStorageFailure("flush")));

        const after = yield* settleAfterWrite(key);
        if (after._tag === "removeDeleted") {
          // delete() raced the write above: undo the resurrected key.
          yield* removeDeleted;
          return false;
        }
        return after._tag === "continue";
      });

      const loop: Effect.Effect<void> = Effect.flatMap(step, (again) =>
        again ? loop : Effect.void
      );

      // Guarantee the slot is released even if the loop dies or is interrupted,
      // honoring a pending tombstone on the way out.
      return loop.pipe(
        Effect.ensuring(
          settleAfterWrite(key).pipe(
            Effect.flatMap((after) =>
              after._tag === "removeDeleted" ? removeDeleted : Effect.void
            )
          )
        )
      );
    };

    /**
     * Set cursor in storage with write throttling.
     * Writes are buffered to max once per 250ms per key.
     */
    const set = (key: string, cursor: StreamCursor) =>
      Effect.gen(function* () {
        // Buffer the cursor and decide whether to arm a flush in one atomic step.
        // Overwriting also clears any tombstone: a set() after delete() wins.
        const shouldSchedule = yield* Ref.modify(pending, (map) => {
          const flushScheduled = map.get(key)?.flushScheduled ?? false;
          const newMap = new Map(map);
          newMap.set(key, { cursor, deleted: false, flushScheduled: true });
          // Only fork a flush if one isn't already in flight for this key.
          return [!flushScheduled, newMap] as const;
        });

        if (shouldSchedule) {
          yield* Effect.forkDaemon(flushLoop(key));
        }
      });

    /**
     * Delete cursor from storage.
     */
    const deleteKey = (key: string) =>
      Effect.gen(function* () {
        const storageKey = makeCursorStorageKey(key);

        // Drop any buffered cursor. A live slot always has an owning flush loop,
        // so leave a tombstone instead of removing it: if the loop's write raced
        // this delete (drained before, wrote after), its post-write check sees the
        // tombstone and removes the resurrected key from storage.
        yield* Ref.update(pending, (map) => {
          if (!map.has(key)) {
            return map;
          }
          const newMap = new Map(map);
          newMap.set(key, { cursor: null, deleted: true, flushScheduled: true });
          return newMap;
        });

        // Remove from storage
        yield* storage.remove(storageKey);
      });

    return CursorStore.of({
      delete: deleteKey,
      get,
      set,
    });
  })
);
