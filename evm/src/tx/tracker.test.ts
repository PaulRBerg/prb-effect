import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { MIN_TX_GAS } from "#src/constants/index.js";
import { TxFailedError } from "#src/core/index.js";
import { TEST_TX_HASH } from "#src/testing-kit/index.js";
import type { TxState } from "#src/tx/index.js";
import { initialTxState, makeTxTracker } from "#src/tx/index.js";

describe("makeTxTracker", () => {
  it.effect("creates tracker with initial idle state", () =>
    Effect.gen(function* () {
      const tracker = yield* makeTxTracker;
      const state = yield* tracker.get;
      expect(state).toEqual({ status: "idle" });
    })
  );

  it("initialTxState is idle", () => {
    expect(initialTxState).toEqual({ status: "idle" });
  });

  it.effect("set() updates state", () =>
    Effect.gen(function* () {
      const tracker = yield* makeTxTracker;
      yield* tracker.set({ hash: TEST_TX_HASH, status: "submitted" });
      const state = yield* tracker.get;
      expect(state.status).toBe("submitted");
      if (state.status === "submitted") {
        expect(state.hash).toBe(TEST_TX_HASH);
      }
    })
  );

  it.effect("update() transforms state", () =>
    Effect.gen(function* () {
      const tracker = yield* makeTxTracker;
      yield* tracker.update(() => ({ status: "signing" }));
      const state = yield* tracker.get;
      expect(state.status).toBe("signing");
    })
  );

  it.effect("update() can access previous state", () =>
    Effect.gen(function* () {
      const tracker = yield* makeTxTracker;
      yield* tracker.set({ hash: TEST_TX_HASH, status: "submitted" });
      yield* tracker.update((prev) =>
        prev.status === "submitted"
          ? ({
              confirmations: 1,
              hash: prev.hash,
              status: "pending",
            } as TxState)
          : prev
      );
      const state = yield* tracker.get;
      expect(state.status).toBe("pending");
      if (state.status === "pending") {
        expect(state.hash).toBe(TEST_TX_HASH);
        expect(state.confirmations).toBe(1);
      }
    })
  );

  it.effect("changes stream is accessible", () =>
    Effect.gen(function* () {
      const tracker = yield* makeTxTracker;
      // Verify that changes stream exists and is a Stream
      expect(tracker.changes).toBeDefined();
      // The actual stream behavior is tested in integration tests
      // as unit testing async streams requires more complex setup
    })
  );

  it.effect("supports all TxState variants", () =>
    Effect.gen(function* () {
      const tracker = yield* makeTxTracker;

      // Test idle
      yield* tracker.set({ status: "idle" });
      let state = yield* tracker.get;
      expect(state.status).toBe("idle");

      // Test simulating
      yield* tracker.set({ status: "simulating" });
      state = yield* tracker.get;
      expect(state.status).toBe("simulating");

      // Test estimated
      yield* tracker.set({ gas: MIN_TX_GAS, status: "estimated" });
      state = yield* tracker.get;
      expect(state.status).toBe("estimated");
      if (state.status === "estimated") {
        expect(state.gas).toBe(MIN_TX_GAS);
      }

      // Test signing
      yield* tracker.set({ status: "signing" });
      state = yield* tracker.get;
      expect(state.status).toBe("signing");

      // Test submitted
      yield* tracker.set({ hash: TEST_TX_HASH, status: "submitted" });
      state = yield* tracker.get;
      expect(state.status).toBe("submitted");
      if (state.status === "submitted") {
        expect(state.hash).toBe(TEST_TX_HASH);
      }

      // Test pending
      yield* tracker.set({
        confirmations: 3,
        hash: TEST_TX_HASH,
        status: "pending",
      });
      state = yield* tracker.get;
      expect(state.status).toBe("pending");
      if (state.status === "pending") {
        expect(state.hash).toBe(TEST_TX_HASH);
        expect(state.confirmations).toBe(3);
      }

      // Test replaced
      yield* tracker.set({
        newHash: "0x9999999999999999999999999999999999999999999999999999999999999999",
        oldHash: TEST_TX_HASH,
        reason: "replaced",
        status: "replaced",
      });
      state = yield* tracker.get;
      expect(state.status).toBe("replaced");
      if (state.status === "replaced") {
        expect(state.oldHash).toBe(TEST_TX_HASH);
      }

      // Test failed
      yield* tracker.set({
        error: new TxFailedError({
          hash: TEST_TX_HASH,
          message: "Failed to confirm receipt",
        }),
        phase: "receipt",
        status: "failed",
      });
      state = yield* tracker.get;
      expect(state.status).toBe("failed");
      if (state.status === "failed") {
        expect(state.phase).toBe("receipt");
      }
    })
  );
});
