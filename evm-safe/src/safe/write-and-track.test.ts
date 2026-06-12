import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Option, Ref, Scope } from "effect";
import type { Hash, TransactionReceipt } from "viem";
import { vi } from "vitest";
import type { SafeAppsServiceShape } from "./service.js";
import { SafeAppsService } from "./service.js";

// The real @prb/effect-evm/tx barrel uses unresolvable #src specifiers under vitest.
vi.mock("@prb/effect-evm/tx", async () => {
  const { Context } = await import("effect");

  class MockTxManager extends Context.Tag("ew3/TxManager")<
    MockTxManager,
    { readonly waitForReceipt: (...args: readonly unknown[]) => Effect.Effect<unknown> }
  >() {}

  return { TxManager: MockTxManager };
});

const { TxManager } = await import("@prb/effect-evm/tx");
const { safeWriteAndTrack } = await import("./write-and-track.js");

const TEST_SAFE_TX_HASH =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as Hash;
const TEST_ONCHAIN_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hash;
const TEST_SAFE_ADDRESS = "0x0000000000000000000000000000000000000001";
const TEST_CONTRACT = "0x0000000000000000000000000000000000000002";
const TEST_CHAIN_ID = 1;

const TEST_RECEIPT = {
  logs: [],
  status: "success",
  transactionHash: TEST_ONCHAIN_HASH,
} as unknown as TransactionReceipt;

function makeSafeAppsServiceLayer(
  getTx: (...args: Parameters<SafeAppsServiceShape["getTx"]>) => Effect.Effect<unknown, unknown>
) {
  return Layer.succeed(
    SafeAppsService,
    SafeAppsService.of({
      enableOffchainSigning: () => Effect.void,
      getInfo: () => Effect.succeed({ chainId: TEST_CHAIN_ID, safeAddress: TEST_SAFE_ADDRESS }),
      getOffchainSignature: () => Effect.dieMessage("unused"),
      getTx,
      pollOffchainSignature: () => Effect.dieMessage("unused"),
      sendTxs: () =>
        Effect.succeed({
          chainId: TEST_CHAIN_ID,
          safeAddress: TEST_SAFE_ADDRESS,
          safeTxHash: TEST_SAFE_TX_HASH,
        }),
      signTypedData: () => Effect.dieMessage("unused"),
      waitForTxReceipt: () => Effect.dieMessage("unused"),
    } as unknown as SafeAppsServiceShape)
  );
}

const txManagerLayer = Layer.succeed(
  TxManager,
  TxManager.of({ waitForReceipt: () => Effect.succeed(TEST_RECEIPT) } as unknown as Parameters<
    typeof TxManager.of
  >[0])
);

const TX = { data: "0x" as const, to: TEST_CONTRACT as `0x${string}`, value: 0n };

describe("safeWriteAndTrack", () => {
  it.live("intermediate states include awaiting_confirmations and awaiting_execution", () => {
    const responses = [
      {
        confirmations: 1,
        confirmationsRequired: 2,
        onchainHash: Option.none(),
        status: "AWAITING_CONFIRMATIONS",
      },
      {
        confirmations: 2,
        confirmationsRequired: 2,
        onchainHash: Option.none(),
        status: "AWAITING_EXECUTION",
      },
      {
        confirmations: 2,
        confirmationsRequired: 2,
        onchainHash: Option.some(TEST_ONCHAIN_HASH),
        status: "SUCCESS",
      },
    ];

    return Effect.gen(function* () {
      const idx = yield* Ref.make(0);
      const seen = yield* Ref.make<string[]>([]);
      const getTx = () =>
        Effect.gen(function* () {
          const i = yield* Ref.getAndUpdate(idx, (n) => Math.min(n + 1, responses.length - 1));
          return responses[i];
        });

      const layer = Layer.merge(makeSafeAppsServiceLayer(getTx), txManagerLayer);

      const handle = yield* safeWriteAndTrack({
        onStateChange: (state) => Ref.update(seen, (xs) => [...xs, state.status]),
        transactions: [TX],
        waitOptions: { interval: "10 millis", maxWait: "5 seconds" },
      }).pipe(Effect.provide(layer));

      const result = yield* handle.result.pipe(Effect.provide(layer));
      const statuses = yield* Ref.get(seen);

      expect(result._tag).toBe("success");
      expect(statuses).toContain("awaiting_confirmations");
      expect(statuses).toContain("awaiting_execution");
      expect(statuses).toContain("success");
    }).pipe(Effect.scoped);
  });

  it.live("does not re-emit identical poll states on every tick", () => {
    // Three identical polls then success: consumers must see exactly one
    // awaiting_confirmations transition, not one per poll.
    const awaiting = {
      confirmations: 1,
      confirmationsRequired: 2,
      onchainHash: Option.none(),
      status: "AWAITING_CONFIRMATIONS",
    };
    const responses = [
      awaiting,
      awaiting,
      awaiting,
      {
        confirmations: 2,
        confirmationsRequired: 2,
        onchainHash: Option.some(TEST_ONCHAIN_HASH),
        status: "SUCCESS",
      },
    ];

    return Effect.gen(function* () {
      const idx = yield* Ref.make(0);
      const seen = yield* Ref.make<string[]>([]);
      const getTx = () =>
        Effect.gen(function* () {
          const i = yield* Ref.getAndUpdate(idx, (n) => Math.min(n + 1, responses.length - 1));
          return responses[i];
        });

      const layer = Layer.merge(makeSafeAppsServiceLayer(getTx), txManagerLayer);

      const handle = yield* safeWriteAndTrack({
        onStateChange: (state) => Ref.update(seen, (xs) => [...xs, state.status]),
        transactions: [TX],
        waitOptions: { interval: "10 millis", maxWait: "5 seconds" },
      }).pipe(Effect.provide(layer));

      const result = yield* handle.result.pipe(Effect.provide(layer));
      const statuses = yield* Ref.get(seen);

      expect(result._tag).toBe("success");
      expect(statuses.filter((s) => s === "awaiting_confirmations")).toHaveLength(1);
    }).pipe(Effect.scoped);
  });

  it.live("result fails with interruption when the scope closes mid-poll (no hang)", () => {
    // getTx never reaches a terminal state, so polling runs until the scope is torn down.
    const getTx = () =>
      Effect.succeed({
        confirmations: 1,
        confirmationsRequired: 2,
        onchainHash: Option.none(),
        status: "AWAITING_CONFIRMATIONS",
      });

    const layer = Layer.merge(makeSafeAppsServiceLayer(getTx), txManagerLayer);

    return Effect.gen(function* () {
      const scope = yield* Scope.make();

      const handle = yield* safeWriteAndTrack({
        transactions: [TX],
        waitOptions: { interval: "10 millis", maxWait: "10 minutes" },
      }).pipe(Effect.provide(layer), Scope.extend(scope));

      // Let polling start, then close the scope to interrupt the forked program.
      yield* Effect.sleep("30 millis");
      yield* Scope.close(scope, Exit.void);

      // Without Effect.ensuring(Deferred.interrupt), this await would hang forever.
      const exit = yield* handle.result.pipe(Effect.provide(layer), Effect.exit);

      expect(Exit.isInterrupted(exit)).toBe(true);
    });
  });
});
