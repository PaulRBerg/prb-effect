import { describe, expect, it } from "@effect/vitest";
import type { Context } from "effect";
import { Chunk, Effect, Layer, Stream } from "effect";
import type { Abi, Address, Hash } from "viem";
import type { DecodedEvent } from "#src/events/index.js";
import {
  CursorStore,
  CursorStream,
  CursorStreamLive,
  EventBackfill,
  EventStream,
  InMemoryCursorStoreLive,
  makeCursorKey,
} from "#src/events/index.js";
import { TEST_ADDRESS, TEST_CHAIN_ID } from "#src/testing-kit/index.js";

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

  // Mock event for testing - use DecodedEvent with generic Abi to avoid complex type inference
  const mockEvent: DecodedEvent = {
    address: TEST_ADDRESS as Address,
    args: {
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: 100n,
    },
    blockNumber: 12345n,
    eventName: "Transfer",
    logIndex: 7,
    removed: false,
    transactionHash: "0xabcd" as Hash,
  };

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

  // Compose layers for CursorStream - use Layer.merge to share the CursorStore
  const testLayer = Layer.mergeAll(
    CursorStreamLive.pipe(Layer.provide(MockEventStreamLive), Layer.provide(MockEventBackfillLive)),
    InMemoryCursorStoreLive
  ).pipe(Layer.provide(InMemoryCursorStoreLive));

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
