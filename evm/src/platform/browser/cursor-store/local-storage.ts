import { Effect, Layer, Ref } from "effect";
import { DEFAULT_CURSOR_FLUSH_DELAY } from "@/src/constants/index.js";
import type { StreamCursor } from "@/src/events/index.js";
import { CursorStore } from "@/src/events/index.js";
import { BrowserStorage } from "@/src/platform/browser/storage/index.js";

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
 * Type for pending write operations.
 */
type PendingWrite = {
  cursor: StreamCursor;
  scheduledAt: number;
};

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

    // Store pending writes per key with their scheduled time
    const pendingWrites = yield* Ref.make(new Map<string, PendingWrite>());

    // Store active timers per key to prevent multiple timers
    const activeTimers = yield* Ref.make(new Map<string, NodeJS.Timeout>());

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
        } catch (_error) {
          // Log warning about corrupt data
          yield* Effect.logWarning(`Corrupt cursor data for key "${key}", deleting entry`);

          // Delete corrupt entry
          yield* storage.remove(storageKey).pipe(Effect.catchAll(() => Effect.void));

          return null;
        }
      });

    /**
     * Set cursor in storage with write throttling.
     * Writes are buffered to max once per 250ms per key.
     */
    const set = (key: string, cursor: StreamCursor) =>
      Effect.gen(function* () {
        const now = Date.now();
        const storageKey = makeCursorStorageKey(key);

        // Update pending write
        yield* Ref.update(pendingWrites, (map) => {
          const newMap = new Map(map);
          newMap.set(key, { cursor, scheduledAt: now });
          return newMap;
        });

        // Check if timer already exists for this key
        const timers = yield* Ref.get(activeTimers);
        const existingTimer = timers.get(key);

        if (existingTimer !== undefined) {
          // Timer already scheduled, pending write will be picked up
          return;
        }

        // Schedule flush after 250ms
        const flushWrite = Effect.gen(function* () {
          // Wait 250ms
          yield* Effect.sleep(DEFAULT_CURSOR_FLUSH_DELAY);

          // Get the pending write
          const pending = yield* Ref.get(pendingWrites);
          const pendingWrite = pending.get(key);

          if (pendingWrite === undefined) {
            return;
          }

          // Remove from pending
          yield* Ref.update(pendingWrites, (map) => {
            const newMap = new Map(map);
            newMap.delete(key);
            return newMap;
          });

          // Remove timer reference
          yield* Ref.update(activeTimers, (map) => {
            const newMap = new Map(map);
            newMap.delete(key);
            return newMap;
          });

          // Perform the actual write
          const serialized = serializeCursor(pendingWrite.cursor);
          yield* storage.set(storageKey, serialized);
        });

        // Fork the flush operation so it runs in background
        const _fiber = yield* Effect.fork(flushWrite);

        // Store a placeholder timer reference (we can't store the actual timeout)
        // The effect fiber itself manages the scheduling
        yield* Ref.update(activeTimers, (map) => {
          const newMap = new Map(map);
          // Use a placeholder value since we're using Effect.fork
          newMap.set(key, {} as NodeJS.Timeout);
          return newMap;
        });
      });

    /**
     * Delete cursor from storage.
     */
    const deleteKey = (key: string) =>
      Effect.gen(function* () {
        const storageKey = makeCursorStorageKey(key);

        // Remove any pending write
        yield* Ref.update(pendingWrites, (map) => {
          const newMap = new Map(map);
          newMap.delete(key);
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
