import { describe, expect, it } from "@effect/vitest";
import type { Scope } from "effect";
import { Chunk, Effect, Layer, Stream } from "effect";
import type { Hash, TransactionReceipt } from "viem";
import { MIN_TX_GAS } from "#src/constants/index.js";
import { makeMockPublicClientLayer, TEST_CHAIN_ID, TEST_TX_HASH } from "#src/testing-kit/index.js";
import { TxManager, TxManagerLive, TxReplacement } from "#src/tx/index.js";

const txReplacementLayer = Layer.succeed(
  TxReplacement,
  TxReplacement.of({
    cancel: () => Effect.succeed(TEST_TX_HASH),
    speedup: () => Effect.succeed(TEST_TX_HASH),
  })
);

const TEST_RECEIPT: TransactionReceipt = {
  blockHash: "0xblock",
  blockNumber: 123n,
  contractAddress: null,
  cumulativeGasUsed: MIN_TX_GAS,
  effectiveGasPrice: 1n,
  from: "0xfrom",
  gasUsed: MIN_TX_GAS,
  logs: [],
  logsBloom: "0x",
  status: "success",
  to: "0xto",
  transactionHash: TEST_TX_HASH,
  transactionIndex: 0,
  type: "0x2",
};

const provideManager = <A, E>(
  effect: Effect.Effect<A, E, TxManager | Scope.Scope>,
  publicClient: Parameters<typeof makeMockPublicClientLayer>[0]
) =>
  effect.pipe(
    Effect.provide(
      Layer.provide(
        TxManagerLive,
        Layer.mergeAll(makeMockPublicClientLayer(publicClient), txReplacementLayer)
      )
    ),
    Effect.scoped
  );

describe("TxManager (A6 unit)", () => {
  describe("track receipt retry", () => {
    it.live(
      "recovers from one transient transport error and ends mined (not failed)",
      () =>
        Effect.gen(function* () {
          let attempts = 0;

          const program = Effect.gen(function* () {
            const manager = yield* TxManager;
            const ref = yield* manager.track(TEST_CHAIN_ID, TEST_TX_HASH);

            const terminal = yield* ref.changes.pipe(
              Stream.filter((state) => state.status === "mined" || state.status === "failed"),
              Stream.take(1),
              Stream.runCollect
            );
            return Chunk.toArray(terminal)[0];
          });

          const result = yield* provideManager(program, {
            waitForTransactionReceipt: (params: { hash: Hash }) => {
              attempts += 1;
              if (attempts === 1) {
                // Transient transport blip on the first poll: previously this marked
                // the tracked tx `failed` terminally. It must now be retried.
                return Promise.reject(new Error("ECONNRESET"));
              }
              return Promise.resolve({
                ...TEST_RECEIPT,
                transactionHash: params.hash,
              } as TransactionReceipt);
            },
          });

          expect(result?.status).toBe("mined");
          expect(attempts).toBeGreaterThanOrEqual(2);
        }),
      15_000
    );
  });

  describe("pending confirmations", () => {
    it.live("publishes confirmations: 0 while the tx is still pending", () =>
      Effect.gen(function* () {
        const program = Effect.gen(function* () {
          const manager = yield* TxManager;
          const ref = yield* manager.track(TEST_CHAIN_ID, TEST_TX_HASH);

          // Collect pending states (emitted from watched blocks) up to and including
          // the eventual mined state.
          const states = yield* ref.changes.pipe(
            Stream.filter((state) => state.status === "pending" || state.status === "mined"),
            Stream.takeUntil((state) => state.status === "mined"),
            Stream.runCollect
          );
          return Chunk.toArray(states);
        });

        const states = yield* provideManager(program, {
          waitForTransactionReceipt: async (params: { hash: Hash }) => {
            // Let a few blocks tick first so a pending state is published.
            await new Promise((resolve) => setTimeout(resolve, 40));
            return { ...TEST_RECEIPT, transactionHash: params.hash } as TransactionReceipt;
          },
          // Emit several blocks while pending so the (internal) block counter would
          // climb past 1 if it were being published as confirmations.
          watchBlockNumber: (params: unknown) => {
            const { onBlockNumber } = params as { onBlockNumber: (n: bigint) => void };
            let n = 100n;
            const id = setInterval(() => {
              n += 1n;
              onBlockNumber(n);
            }, 5);
            return () => clearInterval(id);
          },
        });

        const pendings = states.filter((s) => s.status === "pending");
        expect(pendings.length).toBeGreaterThan(0);
        // Every pending update must report 0 confirmations. The old code published the
        // running blocks-elapsed counter (1, 2, 3, ...) here.
        for (const p of pendings) {
          if (p.status === "pending") {
            expect(p.confirmations).toBe(0);
          }
        }
        expect(states.some((s) => s.status === "mined")).toBe(true);
      })
    );
  });
});
