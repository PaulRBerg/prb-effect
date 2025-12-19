import { describe, expect, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import type { Address, Block, Hash, Hex, Log } from "viem";
import { mainnet } from "viem/chains";
import { SubscriptionService } from "@/src/subscriptions/index.js";
import { makeMockSubscriptionServiceLayer } from "@/src/testing-kit/index.js";

describe("testing-kit: makeMockSubscriptionServiceLayer", () => {
  describe("watchBlocks", () => {
    it.effect("returns a Stream", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const blockStream = yield* service.watchBlocks({
          chainId: mainnet.id,
        });

        expect(typeof blockStream).toBe("object");
      }).pipe(Effect.provide(makeMockSubscriptionServiceLayer()))
    );

    it.effect("emits blocks when configured", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const blockStream = yield* service.watchBlocks({
          chainId: mainnet.id,
          includeTransactions: true,
        });

        const firstBlock = yield* Stream.runHead(blockStream);
        expect(firstBlock._tag).toBe("Some");
        if (firstBlock._tag === "Some") {
          expect(firstBlock.value.number).toBe(1000n);
        }
      }).pipe(
        Effect.provide(
          makeMockSubscriptionServiceLayer({
            watchBlocks: () =>
              Effect.succeed(
                Stream.make({
                  hash: "0xblockhash",
                  number: 1000n,
                  timestamp: 1234567890n,
                } as unknown as Block)
              ),
          })
        )
      )
    );

    it.effect("fails with error for unsupported chainId", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const exit = yield* Effect.exit(
          service.watchBlocks({
            chainId: 123_456_789,
          })
        );

        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(makeMockSubscriptionServiceLayer({}, 1)))
    );
  });

  describe("watchLogs", () => {
    it.effect("returns a Stream", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const logStream = yield* service.watchLogs({
          chainId: mainnet.id,
        });

        expect(typeof logStream).toBe("object");
      }).pipe(Effect.provide(makeMockSubscriptionServiceLayer()))
    );

    it.effect("emits logs when configured", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const logStream = yield* service.watchLogs({
          address: "0x1234567890123456789012345678901234567890",
          chainId: mainnet.id,
        });

        const firstLog = yield* Stream.runHead(logStream);
        expect(firstLog._tag).toBe("Some");
        if (firstLog._tag === "Some") {
          expect(firstLog.value.address).toBe("0x1234567890123456789012345678901234567890");
        }
      }).pipe(
        Effect.provide(
          makeMockSubscriptionServiceLayer({
            watchLogs: () =>
              Effect.succeed(
                Stream.make({
                  address: "0x1234567890123456789012345678901234567890" as Address,
                  blockHash: "0xblockhash" as Hash,
                  blockNumber: 100n,
                  data: "0x" as Hex,
                  logIndex: 0,
                  removed: false,
                  topics: [] as Hex[],
                  transactionHash: "0xtxhash" as Hash,
                  transactionIndex: 0,
                } as Log)
              ),
          })
        )
      )
    );

    it.effect("fails with error for unsupported chainId", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const exit = yield* Effect.exit(
          service.watchLogs({
            chainId: 123_456_789,
          })
        );

        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(makeMockSubscriptionServiceLayer({}, 1)))
    );
  });

  describe("watchPendingTransactions", () => {
    it.effect("returns a Stream", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const txStream = yield* service.watchPendingTransactions({
          chainId: mainnet.id,
        });

        expect(typeof txStream).toBe("object");
      }).pipe(Effect.provide(makeMockSubscriptionServiceLayer()))
    );

    it.effect("emits transaction hashes when configured", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const txStream = yield* service.watchPendingTransactions({
          chainId: mainnet.id,
        });

        const firstHash = yield* Stream.runHead(txStream);
        expect(firstHash._tag).toBe("Some");
        if (firstHash._tag === "Some") {
          expect(firstHash.value).toBe(
            "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
          );
        }
      }).pipe(
        Effect.provide(
          makeMockSubscriptionServiceLayer({
            watchPendingTransactions: () =>
              Effect.succeed(
                Stream.make(
                  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hash
                )
              ),
          })
        )
      )
    );

    it.effect("fails with error for unsupported chainId", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const exit = yield* Effect.exit(
          service.watchPendingTransactions({
            chainId: 123_456_789,
          })
        );

        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(makeMockSubscriptionServiceLayer({}, 1)))
    );
  });

  describe("hasWebSocket", () => {
    it.effect("returns boolean", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const hasWs = yield* service.hasWebSocket(1);

        expect(typeof hasWs).toBe("boolean");
      }).pipe(Effect.provide(makeMockSubscriptionServiceLayer()))
    );

    it.effect("returns false by default", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const hasWs = yield* service.hasWebSocket(1);

        expect(hasWs).toBe(false);
      }).pipe(Effect.provide(makeMockSubscriptionServiceLayer()))
    );

    it.effect("returns true when configured", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const hasWs = yield* service.hasWebSocket(1);

        expect(hasWs).toBe(true);
      }).pipe(
        Effect.provide(
          makeMockSubscriptionServiceLayer({
            hasWebSocket: () => Effect.succeed(true),
          })
        )
      )
    );

    it.effect("fails with error for unsupported chainId", () =>
      Effect.gen(function* () {
        const service = yield* SubscriptionService;
        const exit = yield* Effect.exit(service.hasWebSocket(999));

        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(makeMockSubscriptionServiceLayer({}, 1)))
    );
  });
});
