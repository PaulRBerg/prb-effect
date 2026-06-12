import { describe, expect, it } from "@effect/vitest";
import type { Context } from "effect";
import { Chunk, Effect, Layer, Stream } from "effect";
import type { Abi, Address, Hash } from "viem";
import type { BackfillParams, DecodedEvent, WatchParams } from "#src/events/index.js";
import {
  CursorStore,
  CursorStream,
  CursorStreamLive,
  EventBackfill,
  EventStream,
  InMemoryCursorStoreLive,
  makeCursorKey,
} from "#src/events/index.js";
import { makeMockPublicClientLayer, TEST_ADDRESS, TEST_CHAIN_ID } from "#src/testing-kit/index.js";

describe("CursorStore", () => {
  it.effect("stores and retrieves cursor", () =>
    Effect.gen(function* () {
      const store = yield* CursorStore;
      const key = makeCursorKey(TEST_CHAIN_ID, TEST_ADDRESS, "Transfer");

      // Should be null initially
      const initial = yield* store.get(key);
      expect(initial).toBeNull();

      // Set cursor
      yield* store.set(key, {
        address: TEST_ADDRESS,
        chainId: TEST_CHAIN_ID,
        eventName: "Transfer",
        lastBlockNumber: 100n,
        lastLogIndex: 5,
        updatedAt: Date.now(),
      });

      // Should retrieve cursor
      const retrieved = yield* store.get(key);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.lastBlockNumber).toBe(100n);
      expect(retrieved?.lastLogIndex).toBe(5);
    }).pipe(Effect.provide(InMemoryCursorStoreLive))
  );

  it.effect("deletes cursor", () =>
    Effect.gen(function* () {
      const store = yield* CursorStore;
      const key = makeCursorKey(TEST_CHAIN_ID, TEST_ADDRESS, "Transfer");

      // Set cursor
      yield* store.set(key, {
        address: TEST_ADDRESS,
        chainId: TEST_CHAIN_ID,
        eventName: "Transfer",
        lastBlockNumber: 100n,
        lastLogIndex: 5,
        updatedAt: Date.now(),
      });

      // Delete cursor
      yield* store.delete(key);

      // Should be null
      const retrieved = yield* store.get(key);
      expect(retrieved).toBeNull();
    }).pipe(Effect.provide(InMemoryCursorStoreLive))
  );
});

describe("CursorStream", () => {
  // Test ABI with Transfer event
  const testAbi = [
    {
      inputs: [
        { indexed: true, name: "from", type: "address" },
        { indexed: true, name: "to", type: "address" },
        { indexed: false, name: "value", type: "uint256" },
      ],
      name: "Transfer",
      type: "event",
    },
  ] as const satisfies Abi;

  // Build a DecodedEvent with a configurable block/logIndex position.
  const makeEvent = (blockNumber: bigint, logIndex: number): DecodedEvent => ({
    address: TEST_ADDRESS as Address,
    args: {
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: 100n,
    },
    blockNumber,
    eventName: "Transfer",
    logIndex,
    removed: false,
    transactionHash: "0xabcd" as Hash,
  });

  // Mock event for testing - use DecodedEvent with generic Abi to avoid complex type inference
  const mockEvent: DecodedEvent = makeEvent(12345n, 7);

  // Mock EventStream that returns our test event
  // Type assertion needed because the mock returns non-generic types while the service expects generic methods
  const MockEventStreamLive = Layer.succeed(EventStream, {
    decodeReceipt: () => Effect.succeed([]),
    watch: () => Effect.succeed(Stream.make(mockEvent)),
  } as Context.Tag.Service<EventStream>);

  // Mock EventBackfill that returns our test event
  // Type assertion needed because the mock returns non-generic types while the service expects generic methods
  const MockEventBackfillLive = Layer.succeed(EventBackfill, {
    fetch: () => Effect.succeed(Stream.make(mockEvent)),
    fetchAll: () => Effect.succeed([mockEvent]),
  } as Context.Tag.Service<EventBackfill>);

  // Build a test layer from custom EventStream / EventBackfill mocks. A mock
  // public client is always provided since CursorStreamLive now resolves the
  // head block in syncWithCursor.
  const makeTestLayer = (
    eventStreamLayer: Layer.Layer<EventStream>,
    eventBackfillLayer: Layer.Layer<EventBackfill>
  ) =>
    Layer.mergeAll(
      CursorStreamLive.pipe(
        Layer.provide(eventStreamLayer),
        Layer.provide(eventBackfillLayer),
        Layer.provide(makeMockPublicClientLayer({ getBlockNumber: async () => 1000n }))
      ),
      InMemoryCursorStoreLive
    ).pipe(Layer.provide(InMemoryCursorStoreLive));

  // Compose layers for CursorStream - use Layer.merge to share the CursorStore
  const testLayer = makeTestLayer(MockEventStreamLive, MockEventBackfillLive);

  it.effect("tracks cursor position through stream", () =>
    Effect.gen(function* () {
      const cursorStream = yield* CursorStream;
      const cursorStore = yield* CursorStore;
      const cursorKey = makeCursorKey(TEST_CHAIN_ID, TEST_ADDRESS, "Transfer");

      // Verify no cursor exists initially
      const initialCursor = yield* cursorStore.get(cursorKey);
      expect(initialCursor).toBeNull();

      // Create watch stream with cursor tracking
      const stream = yield* cursorStream.watchWithCursor({
        abi: testAbi,
        address: TEST_ADDRESS as Address,
        chainId: TEST_CHAIN_ID,
        cursorKey,
        eventName: "Transfer",
      });

      // Consume one event from the stream
      const eventsChunk = yield* Stream.runCollect(Stream.take(stream, 1));
      const events = Chunk.toArray(eventsChunk);
      expect(events.length).toBe(1);
      expect(events[0]?.eventName).toBe("Transfer");
      expect(events[0]?.blockNumber).toBe(12345n);

      // Verify cursor was updated with the event position
      const updatedCursor = yield* cursorStore.get(cursorKey);
      expect(updatedCursor).not.toBeNull();
      expect(updatedCursor?.lastBlockNumber).toBe(12345n);
      expect(updatedCursor?.lastLogIndex).toBe(7);
      expect(updatedCursor?.eventName).toBe("Transfer");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("resume mid-block replays remaining same-block events exactly once", () => {
    // Capture the fromBlock the cursor logic hands to EventStream.watch.
    const captured: { fromBlock?: bigint } = {};
    // Full block (logIndex 0-4) plus a later block; the cursor filter must drop
    // 0-2 (already delivered) and keep 3, 4, and the next block.
    const watchEvents = [
      makeEvent(100n, 0),
      makeEvent(100n, 1),
      makeEvent(100n, 2),
      makeEvent(100n, 3),
      makeEvent(100n, 4),
      makeEvent(101n, 0),
    ];
    const ResumeEventStreamLive = Layer.succeed(EventStream, {
      decodeReceipt: () => Effect.succeed([]),
      watch: (params: WatchParams<Abi, string>) => {
        captured.fromBlock = params.fromBlock;
        return Effect.succeed(Stream.fromIterable(watchEvents));
      },
    } as Context.Tag.Service<EventStream>);

    return Effect.gen(function* () {
      const cursorStream = yield* CursorStream;
      const cursorStore = yield* CursorStore;
      const cursorKey = makeCursorKey(TEST_CHAIN_ID, TEST_ADDRESS, "Transfer");

      // Pre-seed a cursor at (block 100, logIndex 2): logIndex 0-2 are delivered.
      yield* cursorStore.set(cursorKey, {
        address: TEST_ADDRESS,
        chainId: TEST_CHAIN_ID,
        eventName: "Transfer",
        lastBlockNumber: 100n,
        lastLogIndex: 2,
        updatedAt: Date.now(),
      });

      const stream = yield* cursorStream.watchWithCursor({
        abi: testAbi,
        address: TEST_ADDRESS as Address,
        chainId: TEST_CHAIN_ID,
        cursorKey,
        eventName: "Transfer",
      });

      const events = Chunk.toArray(yield* Stream.runCollect(stream));

      // Resume is inclusive of the cursor block, not +1.
      expect(captured.fromBlock).toBe(100n);
      // Only events strictly after (100, 2) survive: (100,3), (100,4), (101,0).
      expect(events.map((e) => [e.blockNumber, e.logIndex])).toEqual([
        [100n, 3],
        [100n, 4],
        [101n, 0],
      ]);
      // Cursor advanced to the last delivered event.
      const finalCursor = yield* cursorStore.get(cursorKey);
      expect(finalCursor?.lastBlockNumber).toBe(101n);
      expect(finalCursor?.lastLogIndex).toBe(0);
    }).pipe(Effect.provide(makeTestLayer(ResumeEventStreamLive, MockEventBackfillLive)));
  });

  it.effect("respects a 0n cursor instead of falling back to fromBlock", () => {
    const captured: { fromBlock?: bigint } = {};
    const ResumeEventStreamLive = Layer.succeed(EventStream, {
      decodeReceipt: () => Effect.succeed([]),
      watch: (params: WatchParams<Abi, string>) => {
        captured.fromBlock = params.fromBlock;
        // logIndex 0 at block 0 is already delivered and must be filtered out.
        return Effect.succeed(Stream.fromIterable([makeEvent(0n, 0), makeEvent(0n, 1)]));
      },
    } as Context.Tag.Service<EventStream>);

    return Effect.gen(function* () {
      const cursorStore = yield* CursorStore;
      const cursorKey = makeCursorKey(TEST_CHAIN_ID, TEST_ADDRESS, "Transfer");

      // A legitimate genesis cursor at block 0.
      yield* cursorStore.set(cursorKey, {
        address: TEST_ADDRESS,
        chainId: TEST_CHAIN_ID,
        eventName: "Transfer",
        lastBlockNumber: 0n,
        lastLogIndex: 0,
        updatedAt: Date.now(),
      });

      const cursorStream = yield* CursorStream;
      const stream = yield* cursorStream.watchWithCursor({
        abi: testAbi,
        address: TEST_ADDRESS as Address,
        chainId: TEST_CHAIN_ID,
        cursorKey,
        // A non-zero fallback that must be ignored because a 0n cursor exists.
        eventName: "Transfer",
        fromBlock: 999n,
      });

      const events = Chunk.toArray(yield* Stream.runCollect(stream));

      // 0n cursor honored: resume from 0, not the 999n fallback.
      expect(captured.fromBlock).toBe(0n);
      expect(events.map((e) => [e.blockNumber, e.logIndex])).toEqual([[0n, 1]]);
    }).pipe(Effect.provide(makeTestLayer(ResumeEventStreamLive, MockEventBackfillLive)));
  });

  it.effect("syncWithCursor with undefined toBlock has no gap between backfill and watch", () => {
    const captured: { backfillToBlock?: bigint; watchFromBlock?: bigint } = {};

    const SyncBackfillLive = Layer.succeed(EventBackfill, {
      fetch: (params: BackfillParams<Abi, string>) => {
        captured.backfillToBlock = params.toBlock;
        return Effect.succeed(Stream.make(makeEvent(500n, 0)));
      },
      fetchAll: () => Effect.succeed([]),
    } as Context.Tag.Service<EventBackfill>);

    const SyncWatchLive = Layer.succeed(EventStream, {
      decodeReceipt: () => Effect.succeed([]),
      watch: (params: WatchParams<Abi, string>) => {
        captured.watchFromBlock = params.fromBlock;
        return Effect.succeed(Stream.make(makeEvent(1001n, 0)));
      },
    } as Context.Tag.Service<EventStream>);

    return Effect.gen(function* () {
      const cursorStream = yield* CursorStream;
      const cursorKey = makeCursorKey(TEST_CHAIN_ID, TEST_ADDRESS, "Transfer");

      const stream = yield* cursorStream.syncWithCursor({
        abi: testAbi,
        address: TEST_ADDRESS as Address,
        chainId: TEST_CHAIN_ID,
        cursorKey,
        eventName: "Transfer",
        fromBlock: 1n,
        // toBlock intentionally undefined -> head resolved from the mock client (1000n).
      });

      const events = Chunk.toArray(yield* Stream.runCollect(stream));

      // Backfill is bounded at the resolved head (1000n) and the watch starts at
      // head + 1 (1001n): the two phases are contiguous with no gap.
      expect(captured.backfillToBlock).toBe(1000n);
      expect(captured.watchFromBlock).toBe(1001n);
      expect(events).toHaveLength(2);
    }).pipe(Effect.provide(makeTestLayer(SyncWatchLive, SyncBackfillLive)));
  });
});

describe("makeCursorKey", () => {
  it("creates consistent cursor key", () => {
    const key1 = makeCursorKey(1, "0xABC", "Transfer");
    const key2 = makeCursorKey(1, "0xabc", "Transfer");
    const key3 = makeCursorKey(1, "0xABC", "Approval");

    // Should normalize address to lowercase
    expect(key1).toBe(key2);

    // Different event names should produce different keys
    expect(key1).not.toBe(key3);
  });
});
