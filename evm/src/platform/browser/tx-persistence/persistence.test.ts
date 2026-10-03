import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, SubscriptionRef } from "effect";
import type { Hash } from "viem";
import { StorageUnavailableError } from "#src/platform/browser/storage/index.js";
import type { PersistedTx, TxStoreShape } from "#src/platform/browser/tx-store/index.js";
import { InMemoryTxStoreLive, makeTxId, TxStore } from "#src/platform/browser/tx-store/index.js";
import type { TxManagerShape, TxState } from "#src/tx/index.js";
import { TxManager } from "#src/tx/index.js";
import { TxPersistence, TxPersistenceLive } from "./persistence.js";

const TEST_CHAIN_ID = 1;
const TEST_HASH = `0x${"1".repeat(64)}` as Hash;
const REPLACEMENT_HASH = `0x${"2".repeat(64)}` as Hash;

const PENDING_STATE: TxState = {
  confirmations: 1,
  hash: TEST_HASH,
  status: "pending",
};

const CANCELLED_STATE: TxState = {
  reason: "safe-cancelled",
  reference: TEST_HASH,
  status: "cancelled",
};

function makeTxManagerMock(stateRef: SubscriptionRef.SubscriptionRef<TxState>): {
  readonly service: TxManagerShape;
  readonly trackCalls: () => number;
} {
  let count = 0;
  return {
    service: {
      getConfirmations: () => Effect.succeed(0n),
      track: () =>
        Effect.sync(() => {
          count += 1;
          return stateRef;
        }),
      waitForReceipt: () => Effect.die(new Error("unused in this test")),
    },
    trackCalls: () => count,
  };
}

function setStateUntilPersisted(options: {
  stateRef: SubscriptionRef.SubscriptionRef<TxState>;
  state: TxState;
  store: TxStoreShape;
  txId: string;
  expectedStatus: PersistedTx["status"];
}): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      yield* SubscriptionRef.set(options.stateRef, { ...options.state });
      const tx = yield* options.store.get(options.txId);
      if (tx?.status === options.expectedStatus) {
        return;
      }
      yield* Effect.yieldNow();
    }

    const tx = yield* options.store.get(options.txId);
    return yield* Effect.fail(
      new Error(
        `Expected persisted status '${options.expectedStatus}', got '${tx?.status ?? "null"}'`
      )
    );
  });
}

describe("TxPersistence", () => {
  for (const state of [
    PENDING_STATE,
    { newHash: REPLACEMENT_HASH, oldHash: TEST_HASH, reason: "repriced", status: "replaced" },
  ] satisfies TxState[]) {
    it.effect(`continues after a storage read failure during ${state.status}`, () =>
      Effect.gen(function* () {
        const store = yield* TxStore;
        const readAttempted = yield* Deferred.make<void>();
        const txStateRef = yield* SubscriptionRef.make<TxState>(state);
        const txId = makeTxId(TEST_CHAIN_ID, TEST_HASH);
        let reads = 0;
        const unavailableOnce: TxStoreShape = {
          ...store,
          get: (id) =>
            Effect.suspend(() => {
              reads += 1;
              return reads === 1
                ? Deferred.succeed(readAttempted, undefined).pipe(
                    Effect.zipRight(
                      Effect.fail(
                        new StorageUnavailableError({ message: "temporarily unavailable" })
                      )
                    )
                  )
                : store.get(id);
            }),
        };
        const program = Effect.gen(function* () {
          const persistence = yield* TxPersistence;
          yield* persistence.trackAndPersist(TEST_CHAIN_ID, TEST_HASH);
          yield* Deferred.await(readAttempted);
          yield* setStateUntilPersisted({
            expectedStatus: "cancelled",
            state: CANCELLED_STATE,
            stateRef: txStateRef,
            store,
            txId,
          });
          const persisted = yield* store.get(txId);
          expect(persisted?.currentHash).toBe(
            state.status === "replaced" ? REPLACEMENT_HASH : TEST_HASH
          );
        });
        yield* program.pipe(
          Effect.provide(TxPersistenceLive),
          Effect.provideService(TxStore, unavailableOnce),
          Effect.provideService(TxManager, makeTxManagerMock(txStateRef).service),
          Effect.scoped
        );
      }).pipe(Effect.provide(InMemoryTxStoreLive))
    );
  }

  it.effect("treats cancelled as terminal and ignores subsequent updates", () =>
    Effect.gen(function* () {
      const txStateRef = yield* SubscriptionRef.make<TxState>({ status: "idle" });
      const txManagerMock = makeTxManagerMock(txStateRef);
      const txId = makeTxId(TEST_CHAIN_ID, TEST_HASH);

      const program = Effect.gen(function* () {
        const persistence = yield* TxPersistence;
        const store = yield* TxStore;

        yield* persistence.trackAndPersist(TEST_CHAIN_ID, TEST_HASH);
        expect(txManagerMock.trackCalls()).toBe(1);

        const initial = yield* store.get(txId);
        expect(initial).not.toBeNull();
        expect(initial?.status).toBe("submitted");

        // Drive state until persistence fiber is active and has observed pending.
        yield* setStateUntilPersisted({
          expectedStatus: "pending",
          state: PENDING_STATE,
          stateRef: txStateRef,
          store,
          txId,
        });

        yield* setStateUntilPersisted({
          expectedStatus: "cancelled",
          state: CANCELLED_STATE,
          stateRef: txStateRef,
          store,
          txId,
        });

        // If cancelled is terminal, these updates must not be persisted.
        for (let attempt = 0; attempt < 50; attempt += 1) {
          yield* SubscriptionRef.set(txStateRef, { ...PENDING_STATE });
          yield* Effect.yieldNow();
        }

        const final = yield* store.get(txId);
        expect(final).not.toBeNull();
        expect(final?.status).toBe("cancelled");
      });

      yield* program.pipe(
        Effect.provide(TxPersistenceLive),
        Effect.provide(InMemoryTxStoreLive),
        Effect.provideService(TxManager, txManagerMock.service),
        Effect.scoped
      );
    })
  );
});
