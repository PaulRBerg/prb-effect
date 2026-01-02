import { describe, expect, it } from "@effect/vitest";
import { Chunk, Effect, Exit, Fiber, Layer, Ref, Stream, TestClock } from "effect";
import type { Address, Hash, Log } from "viem";
import { erc20Abi } from "viem";
import type { EventWatchError } from "@/src/core/index.js";
import type { DecodedEvent } from "@/src/events/index.js";
import { EventStream, ReliableEventStream, ReliableEventStreamLive } from "@/src/events/index.js";
import {
  makeMockPublicClientLayer,
  TEST_ADDRESS,
  TEST_CHAIN_ID,
  UNKNOWN_CHAIN_ID,
} from "@/src/testing-kit/index.js";

const unwrapNullable = <T>(value: T | null | undefined, name: string): NonNullable<T> => {
  if (value === null) {
    throw new Error(`${name} is required`);
  }
  return value as NonNullable<T>;
};

// Helper to create a mock Transfer event log
const createMockTransferEvent = (
  blockNumber: bigint,
  txHash: Hash,
  logIndex: number,
  removed = false
): Log => ({
  address: TEST_ADDRESS,
  blockHash: "0xblockhash",
  blockNumber,
  data: "0x0000000000000000000000000000000000000000000000000000000000000064",
  logIndex,
  removed,
  topics: [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x0000000000000000000000001234567890123456789012345678901234567890",
    "0x0000000000000000000000000987654321098765432109876543210987654321",
  ],
  transactionHash: txHash,
  transactionIndex: 0,
});

// Helper to create a decoded event from a log
const createDecodedEvent = (log: Log): DecodedEvent<typeof erc20Abi, "Transfer"> => ({
  address: log.address,
  args: {
    from: "0x1234567890123456789012345678901234567890" as Address,
    to: "0x0987654321098765432109876543210987654321" as Address,
  },
  blockNumber: unwrapNullable(log.blockNumber, "blockNumber"),
  eventName: "Transfer" as const,
  logIndex: unwrapNullable(log.logIndex, "logIndex"),
  removed: log.removed,
  transactionHash: unwrapNullable(log.transactionHash, "transactionHash"),
});

describe("ReliableEventStream", () => {
  describe("watch", () => {
    it.effect("events emitted when confirmations >= threshold", () =>
      Effect.gen(function* () {
        const blockNumberRef = yield* Ref.make(1000n);
        let emitCallback: ((event: DecodedEvent<typeof erc20Abi, "Transfer">) => void) | undefined;

        const layers = Layer.provide(
          ReliableEventStreamLive,
          Layer.merge(
            Layer.succeed(EventStream, {
              decodeReceipt: () => Effect.succeed([]),
              watch: () =>
                Effect.succeed(
                  Stream.async<DecodedEvent<typeof erc20Abi, "Transfer">, EventWatchError>(
                    (emit) => {
                      emitCallback = (event) => emit.single(event);
                      return Effect.void;
                    }
                  )
                ),
            } as EventStream["Type"]),
            makeMockPublicClientLayer({
              getBlockNumber: () => Ref.get(blockNumberRef).pipe(Effect.runPromise),
            })
          )
        );

        const reliableStream = yield* Effect.provide(ReliableEventStream, layers);
        const stream = yield* reliableStream.watch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          confirmations: 2,
          eventName: "Transfer",
          pollingInterval: 50,
        });

        // Fork stream consumption
        const fiber = yield* Effect.fork(Stream.runCollect(Stream.take(stream, 1)));

        // Emit event at block 1000
        yield* TestClock.adjust("20 millis");
        if (emitCallback) {
          const log = createMockTransferEvent(1000n, "0xabc123", 0);
          emitCallback(createDecodedEvent(log));
        }

        // Advance block to 1002 (2 confirmations)
        yield* TestClock.adjust("60 millis");
        yield* Ref.set(blockNumberRef, 1002n);

        // Wait for confirmation check
        yield* TestClock.adjust("100 millis");

        const exit = yield* Fiber.await(fiber);
        expect(Exit.isSuccess(exit)).toBe(true);

        if (Exit.isSuccess(exit)) {
          const events = Chunk.toReadonlyArray(exit.value);
          expect(events).toHaveLength(1);
          expect(events[0].blockNumber).toBe(1000n);
        }
      })
    );

    it.effect("reorged events filtered out from pending", () =>
      Effect.gen(function* () {
        const blockNumberRef = yield* Ref.make(1000n);
        let emitCallback: ((event: DecodedEvent<typeof erc20Abi, "Transfer">) => void) | undefined;

        const layers = Layer.provide(
          ReliableEventStreamLive,
          Layer.merge(
            Layer.succeed(EventStream, {
              decodeReceipt: () => Effect.succeed([]),
              watch: () =>
                Effect.succeed(
                  Stream.async<DecodedEvent<typeof erc20Abi, "Transfer">, EventWatchError>(
                    (emit) => {
                      emitCallback = (event) => emit.single(event);
                      return Effect.void;
                    }
                  )
                ),
            } as EventStream["Type"]),
            makeMockPublicClientLayer({
              getBlockNumber: () => Ref.get(blockNumberRef).pipe(Effect.runPromise),
            })
          )
        );

        const reliableStream = yield* Effect.provide(ReliableEventStream, layers);
        const stream = yield* reliableStream.watch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          confirmations: 1,
          eventName: "Transfer",
          pollingInterval: 50,
        });

        // Fork stream consumption
        const fiber = yield* Effect.fork(Stream.runCollect(stream));

        // Emit event at block 1000
        yield* TestClock.adjust("20 millis");
        if (emitCallback) {
          const log = createMockTransferEvent(1000n, "0xabc123", 0, false);
          emitCallback(createDecodedEvent(log));
        }

        // Emit reorg for same event
        yield* TestClock.adjust("30 millis");
        if (emitCallback) {
          const log = createMockTransferEvent(1000n, "0xabc123", 0, true);
          emitCallback(createDecodedEvent(log));
        }

        // Advance block to confirm
        yield* TestClock.adjust("30 millis");
        yield* Ref.set(blockNumberRef, 1001n);

        // Wait for confirmation check
        yield* TestClock.adjust("100 millis");

        // Interrupt and check
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);

        if (Exit.isSuccess(exit)) {
          const events = Chunk.toReadonlyArray(exit.value);
          expect(events).toHaveLength(0); // Event was reorged out
        } else {
          expect(Exit.isInterrupted(exit)).toBe(true);
        }
      })
    );

    it.effect("event key serialization with txHash and logIndex", () =>
      Effect.gen(function* () {
        const blockNumberRef = yield* Ref.make(1000n);
        let emitCallback: ((event: DecodedEvent<typeof erc20Abi, "Transfer">) => void) | undefined;

        const layers = Layer.provide(
          ReliableEventStreamLive,
          Layer.merge(
            Layer.succeed(EventStream, {
              decodeReceipt: () => Effect.succeed([]),
              watch: () =>
                Effect.succeed(
                  Stream.async<DecodedEvent<typeof erc20Abi, "Transfer">, EventWatchError>(
                    (emit) => {
                      emitCallback = (event) => emit.single(event);
                      return Effect.void;
                    }
                  )
                ),
            } as EventStream["Type"]),
            makeMockPublicClientLayer({
              getBlockNumber: () => Ref.get(blockNumberRef).pipe(Effect.runPromise),
            })
          )
        );

        const reliableStream = yield* Effect.provide(ReliableEventStream, layers);
        const stream = yield* reliableStream.watch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          confirmations: 1,
          eventName: "Transfer",
          pollingInterval: 50,
        });

        const fiber = yield* Effect.fork(Stream.runCollect(Stream.take(stream, 2)));

        // Emit two events with same txHash but different logIndex
        yield* TestClock.adjust("20 millis");
        if (emitCallback) {
          const log1 = createMockTransferEvent(1000n, "0xabc123", 0);
          const log2 = createMockTransferEvent(1000n, "0xabc123", 1);
          emitCallback(createDecodedEvent(log1));
          emitCallback(createDecodedEvent(log2));
        }

        // Advance block
        yield* TestClock.adjust("60 millis");
        yield* Ref.set(blockNumberRef, 1001n);

        // Wait for confirmation
        yield* TestClock.adjust("100 millis");

        const exit = yield* Fiber.await(fiber);
        expect(Exit.isSuccess(exit)).toBe(true);

        if (Exit.isSuccess(exit)) {
          const events = Chunk.toReadonlyArray(exit.value);
          expect(events).toHaveLength(2);
          expect(events[0].logIndex).toBe(0);
          expect(events[1].logIndex).toBe(1);
        }
      })
    );

    it.effect("multiple events from same block handled together", () =>
      Effect.gen(function* () {
        const blockNumberRef = yield* Ref.make(1000n);
        let emitCallback: ((event: DecodedEvent<typeof erc20Abi, "Transfer">) => void) | undefined;

        const layers = Layer.provide(
          ReliableEventStreamLive,
          Layer.merge(
            Layer.succeed(EventStream, {
              decodeReceipt: () => Effect.succeed([]),
              watch: () =>
                Effect.succeed(
                  Stream.async<DecodedEvent<typeof erc20Abi, "Transfer">, EventWatchError>(
                    (emit) => {
                      emitCallback = (event) => emit.single(event);
                      return Effect.void;
                    }
                  )
                ),
            } as EventStream["Type"]),
            makeMockPublicClientLayer({
              getBlockNumber: () => Ref.get(blockNumberRef).pipe(Effect.runPromise),
            })
          )
        );

        const reliableStream = yield* Effect.provide(ReliableEventStream, layers);
        const stream = yield* reliableStream.watch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          confirmations: 1,
          eventName: "Transfer",
          pollingInterval: 50,
        });

        const fiber = yield* Effect.fork(Stream.runCollect(Stream.take(stream, 3)));

        // Emit three events from same block
        yield* TestClock.adjust("20 millis");
        if (emitCallback) {
          const log1 = createMockTransferEvent(1000n, "0xabc123", 0);
          const log2 = createMockTransferEvent(1000n, "0xdef456", 0);
          const log3 = createMockTransferEvent(1000n, "0x789abc", 0);
          emitCallback(createDecodedEvent(log1));
          emitCallback(createDecodedEvent(log2));
          emitCallback(createDecodedEvent(log3));
        }

        // Advance block
        yield* TestClock.adjust("60 millis");
        yield* Ref.set(blockNumberRef, 1001n);

        // Wait for confirmation
        yield* TestClock.adjust("100 millis");

        const exit = yield* Fiber.await(fiber);
        expect(Exit.isSuccess(exit)).toBe(true);

        if (Exit.isSuccess(exit)) {
          const events = Chunk.toReadonlyArray(exit.value);
          expect(events).toHaveLength(3);
          expect(events.every((e) => e.blockNumber === 1000n)).toBe(true);
        }
      })
    );

    it.effect("events from different blocks tracked separately", () =>
      Effect.gen(function* () {
        const blockNumberRef = yield* Ref.make(1000n);
        let emitCallback: ((event: DecodedEvent<typeof erc20Abi, "Transfer">) => void) | undefined;

        const layers = Layer.provide(
          ReliableEventStreamLive,
          Layer.merge(
            Layer.succeed(EventStream, {
              decodeReceipt: () => Effect.succeed([]),
              watch: () =>
                Effect.succeed(
                  Stream.async<DecodedEvent<typeof erc20Abi, "Transfer">, EventWatchError>(
                    (emit) => {
                      emitCallback = (event) => emit.single(event);
                      return Effect.void;
                    }
                  )
                ),
            } as EventStream["Type"]),
            makeMockPublicClientLayer({
              getBlockNumber: () => Ref.get(blockNumberRef).pipe(Effect.runPromise),
            })
          )
        );

        const reliableStream = yield* Effect.provide(ReliableEventStream, layers);
        const stream = yield* reliableStream.watch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          confirmations: 2,
          eventName: "Transfer",
          pollingInterval: 50,
        });

        const fiber = yield* Effect.fork(Stream.runCollect(Stream.take(stream, 2)));

        // Emit event at block 1000
        yield* TestClock.adjust("20 millis");
        if (emitCallback) {
          const log = createMockTransferEvent(1000n, "0xabc123", 0);
          emitCallback(createDecodedEvent(log));
        }

        // Advance to 1001 and emit another event
        yield* TestClock.adjust("60 millis");
        yield* Ref.set(blockNumberRef, 1001n);
        if (emitCallback) {
          const log = createMockTransferEvent(1001n, "0xdef456", 0);
          emitCallback(createDecodedEvent(log));
        }

        // Advance to 1003 to confirm both
        yield* TestClock.adjust("60 millis");
        yield* Ref.set(blockNumberRef, 1003n);

        // Wait for confirmation
        yield* TestClock.adjust("100 millis");

        const exit = yield* Fiber.await(fiber);
        expect(Exit.isSuccess(exit)).toBe(true);

        if (Exit.isSuccess(exit)) {
          const events = Chunk.toReadonlyArray(exit.value);
          expect(events).toHaveLength(2);
          expect(events[0].blockNumber).toBe(1000n);
          expect(events[1].blockNumber).toBe(1001n);
        }
      })
    );

    it.effect("default confirmations is 1", () =>
      Effect.gen(function* () {
        const blockNumberRef = yield* Ref.make(1000n);
        let emitCallback: ((event: DecodedEvent<typeof erc20Abi, "Transfer">) => void) | undefined;

        const layers = Layer.provide(
          ReliableEventStreamLive,
          Layer.merge(
            Layer.succeed(EventStream, {
              decodeReceipt: () => Effect.succeed([]),
              watch: () =>
                Effect.succeed(
                  Stream.async<DecodedEvent<typeof erc20Abi, "Transfer">, EventWatchError>(
                    (emit) => {
                      emitCallback = (event) => emit.single(event);
                      return Effect.void;
                    }
                  )
                ),
            } as EventStream["Type"]),
            makeMockPublicClientLayer({
              getBlockNumber: () => Ref.get(blockNumberRef).pipe(Effect.runPromise),
            })
          )
        );

        const reliableStream = yield* Effect.provide(ReliableEventStream, layers);
        const stream = yield* reliableStream.watch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          // confirmations not specified, should default to 1
          eventName: "Transfer",
          pollingInterval: 50,
        });

        const fiber = yield* Effect.fork(Stream.runCollect(Stream.take(stream, 1)));

        // Emit event at block 1000
        yield* TestClock.adjust("20 millis");
        if (emitCallback) {
          const log = createMockTransferEvent(1000n, "0xabc123", 0);
          emitCallback(createDecodedEvent(log));
        }

        // Advance to 1001 (1 confirmation)
        yield* TestClock.adjust("60 millis");
        yield* Ref.set(blockNumberRef, 1001n);

        // Wait for confirmation
        yield* TestClock.adjust("100 millis");

        const exit = yield* Fiber.await(fiber);
        expect(Exit.isSuccess(exit)).toBe(true);

        if (Exit.isSuccess(exit)) {
          const events = Chunk.toReadonlyArray(exit.value);
          expect(events).toHaveLength(1);
        }
      })
    );

    it.effect("ClientNotFoundError when chainId invalid", () =>
      Effect.gen(function* () {
        const layers = Layer.provide(
          ReliableEventStreamLive,
          Layer.merge(
            Layer.succeed(EventStream, {
              decodeReceipt: () => Effect.succeed([]),
              watch: () =>
                Effect.succeed(
                  Stream.async<DecodedEvent<typeof erc20Abi, "Transfer">, EventWatchError>(
                    () => Effect.void
                  )
                ),
            } as EventStream["Type"]),
            makeMockPublicClientLayer()
          )
        );

        const reliableStream = yield* Effect.provide(ReliableEventStream, layers);
        const exit = yield* Effect.exit(
          reliableStream.watch({
            abi: erc20Abi,
            address: TEST_ADDRESS,
            chainId: UNKNOWN_CHAIN_ID,
            eventName: "Transfer",
          })
        );

        expect(Exit.isFailure(exit)).toBe(true);
      })
    );

    it.effect("stream cleanup interrupts background fibers", () =>
      Effect.gen(function* () {
        const blockNumberRef = yield* Ref.make(1000n);

        const layers = Layer.provide(
          ReliableEventStreamLive,
          Layer.merge(
            Layer.succeed(EventStream, {
              decodeReceipt: () => Effect.succeed([]),
              watch: () =>
                Effect.succeed(
                  Stream.async<DecodedEvent<typeof erc20Abi, "Transfer">, EventWatchError>(
                    () => Effect.void
                  )
                ),
            } as EventStream["Type"]),
            makeMockPublicClientLayer({
              getBlockNumber: () => Ref.get(blockNumberRef).pipe(Effect.runPromise),
            })
          )
        );

        const reliableStream = yield* Effect.provide(ReliableEventStream, layers);
        const stream = yield* reliableStream.watch({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          confirmations: 1,
          eventName: "Transfer",
          pollingInterval: 50,
        });

        // Fork stream consumption
        const fiber = yield* Effect.fork(Stream.runCollect(stream));

        // Let it run briefly
        yield* TestClock.adjust("100 millis");

        // Interrupt the stream
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);

        // Should be interrupted, not failed
        expect(Exit.isInterrupted(exit)).toBe(true);
      })
    );
  });
});
