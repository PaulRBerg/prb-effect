import { describe, expect, it } from "@effect/vitest";
import { WriteExecutionAdapter } from "@prb/effect-evm/contract/pipeline";
import type { TxState } from "@prb/effect-evm/tx";
import { TxManager } from "@prb/effect-evm/tx";
import { Effect, Exit, Fiber, Layer, Option, Stream, SubscriptionRef } from "effect";
import type { Hash, Hex, Log, TransactionReceipt } from "viem";
import { encodeEventTopics, erc20Abi, pad, toHex } from "viem";
import { afterEach, vi } from "vitest";
import { SafeWriteExecutionAdapterLive } from "./pipeline-adapter.js";
import type { SafeAppsServiceShape } from "./service.js";
import { SafeAppsService } from "./service.js";
import type { SafeWriteAndTrackResult, SafeWriteAndTrackState } from "./write-and-track.js";

vi.mock(
  "@prb/effect-evm/contract/pipeline",
  async () => import("../../../evm/src/contract/pipeline/adapter.js")
);

// The real `@prb/effect-evm/events` barrel transitively imports modules using the evm package's
// `#src/*` subpath specifiers, which the evm-safe vitest resolver cannot map. Provide a faithful,
// self-contained `decodeReceiptLogs` (same semantics as evm/src/events/decoder.ts) so the adapter's
// production codepath is exercised without dragging in the barrel.
vi.mock("@prb/effect-evm/events", async () => {
  const { Array: Arr, Effect, Option } = await import("effect");
  const { decodeEventLog } = await import("viem");

  const tryDecodeLog = (log: Log, abi: readonly unknown[]) => {
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      return Option.some({
        address: log.address,
        args: decoded.args,
        blockNumber: log.blockNumber ?? 0n,
        eventName: decoded.eventName,
        logIndex: log.logIndex ?? 0,
        removed: log.removed ?? false,
        transactionHash: log.transactionHash ?? "0x",
      });
    } catch {
      return Option.none();
    }
  };

  return {
    decodeReceiptLogs: (receipt: TransactionReceipt, abi: readonly unknown[]) =>
      Effect.sync(() => Arr.getSomes(receipt.logs.map((log) => tryDecodeLog(log, abi)))),
  };
});

const safeWriteAndTrackOverride = vi.hoisted(() => ({
  impl: null as
    | null
    | ((params: unknown) => Effect.Effect<SafeWriteAndTrackResult, unknown, unknown>),
}));

vi.mock("./write-and-track.js", async () => {
  const actual =
    await vi.importActual<typeof import("./write-and-track.js")>("./write-and-track.js");

  return {
    ...actual,
    safeWriteAndTrack: (params: Parameters<typeof actual.safeWriteAndTrack>[0]) =>
      safeWriteAndTrackOverride.impl
        ? safeWriteAndTrackOverride.impl(params)
        : actual.safeWriteAndTrack(params),
  };
});

vi.mock("@prb/effect-evm/tx", async () => {
  const { Context } = await import("effect");

  class MockTxManager extends Context.Tag("ew3/TxManager")<
    MockTxManager,
    {
      readonly getConfirmations: (...args: readonly unknown[]) => Effect.Effect<bigint>;
      readonly track: (...args: readonly unknown[]) => Effect.Effect<unknown>;
      readonly waitForReceipt: (...args: readonly unknown[]) => Effect.Effect<unknown>;
    }
  >() {}

  return {
    initialTxState: { status: "idle" } as const,
    TxManager: MockTxManager,
  };
});

vi.mock("@prb/effect-evm/core/errors", () => {
  class MockTxFailedError extends Error {
    readonly hash: string;

    constructor(args: {
      readonly cause?: unknown;
      readonly hash: string;
      readonly message: string;
    }) {
      super(args.message);
      this.cause = args.cause;
      this.hash = args.hash;
      this.name = "TxFailedError";
    }
  }

  return { TxFailedError: MockTxFailedError };
});

const TEST_SAFE_TX_HASH =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as Hash;
const TEST_ONCHAIN_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hash;
const TEST_MESSAGE_HASH =
  "0xfeedface1234567890abcdef1234567890abcdef1234567890abcdef12345678" as Hex;
const TEST_SIGNATURE = "0xsignature" as Hex;
const TEST_ACCOUNT = "0x0000000000000000000000000000000000000001";
const TEST_CONTRACT = "0x0000000000000000000000000000000000000002";
const TEST_RECIPIENT = "0x0000000000000000000000000000000000000003";
const TEST_CHAIN_ID = 1;

const TEST_RECEIPT = {
  logs: [],
  status: "success",
  transactionHash: TEST_ONCHAIN_HASH,
} as unknown as TransactionReceipt;

const TRANSFER_LOG: Log = {
  address: TEST_CONTRACT,
  blockHash: "0x" as Hash,
  blockNumber: 1n,
  data: pad(toHex(100n)),
  logIndex: 0,
  removed: false,
  // Both indexed args are provided, so no topic slot is null.
  topics: encodeEventTopics({
    abi: erc20Abi,
    args: { from: TEST_ACCOUNT, to: TEST_RECIPIENT },
    eventName: "Transfer",
  }) as [Hex, ...Hex[]],
  transactionHash: TEST_ONCHAIN_HASH,
  transactionIndex: 0,
};

const TEST_RECEIPT_WITH_LOG = {
  logs: [TRANSFER_LOG],
  status: "success",
  transactionHash: TEST_ONCHAIN_HASH,
} as unknown as TransactionReceipt;

function makeSafeAppsServiceLayer(
  getTx: (
    ...args: Parameters<SafeAppsServiceShape["getTx"]>
  ) => ReturnType<SafeAppsServiceShape["getTx"]>
) {
  const service = SafeAppsService.of({
    enableOffchainSigning: () => Effect.void,
    getInfo: () =>
      Effect.succeed({
        chainId: TEST_CHAIN_ID,
        safeAddress: TEST_ACCOUNT,
      }),
    getOffchainSignature: () => Effect.succeed(Option.some(TEST_SIGNATURE)),
    getTx,
    pollOffchainSignature: () =>
      Effect.succeed({
        messageHash: TEST_MESSAGE_HASH,
        signature: TEST_SIGNATURE,
      }),
    sendTxs: () =>
      Effect.succeed({
        chainId: TEST_CHAIN_ID,
        safeAddress: TEST_ACCOUNT,
        safeTxHash: TEST_SAFE_TX_HASH,
      }),
    signTypedData: () => Effect.dieMessage("unused in this test"),
    waitForTxReceipt: () => Effect.dieMessage("unused in this test"),
  } as unknown as SafeAppsServiceShape);

  return Layer.succeed(SafeAppsService, service);
}

const txManagerLayer = Layer.succeed(
  TxManager,
  TxManager.of({
    getConfirmations: () => Effect.succeed(0n),
    track: () => Effect.dieMessage("unused in this test"),
    waitForReceipt: () => Effect.succeed(TEST_RECEIPT),
  } as Parameters<typeof TxManager.of>[0])
);

const makeAdapterRuntimeLayer = (
  getTx: (
    ...args: Parameters<SafeAppsServiceShape["getTx"]>
  ) => ReturnType<SafeAppsServiceShape["getTx"]>
) =>
  Layer.provide(
    SafeWriteExecutionAdapterLive,
    Layer.mergeAll(txManagerLayer, makeSafeAppsServiceLayer(getTx))
  );

afterEach(() => {
  safeWriteAndTrackOverride.impl = null;
});

describe("SafeWriteExecutionAdapterLive", () => {
  it.effect("canHandle resolves by Safe chain metadata", () =>
    Effect.gen(function* () {
      const adapter = yield* WriteExecutionAdapter;

      const canHandleSafe = yield* adapter.canHandle({
        abi: erc20Abi,
        account: TEST_ACCOUNT,
        address: TEST_CONTRACT,
        args: [TEST_RECIPIENT, 100n],
        chainId: TEST_CHAIN_ID,
        functionName: "transfer",
      });

      const canHandleOtherChain = yield* adapter.canHandle({
        abi: erc20Abi,
        account: TEST_ACCOUNT,
        address: TEST_CONTRACT,
        args: [TEST_RECIPIENT, 100n],
        chainId: 137,
        functionName: "transfer",
      });

      expect(canHandleSafe).toBe(true);
      expect(canHandleOtherChain).toBe(false);
    }).pipe(
      Effect.provide(
        makeAdapterRuntimeLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          })
        )
      )
    )
  );

  it.effect("writeAndTrack maps successful Safe execution into mined TxState", () =>
    Effect.gen(function* () {
      const adapter = yield* WriteExecutionAdapter;

      const execution = yield* adapter.writeAndTrack({
        abi: erc20Abi,
        account: TEST_ACCOUNT,
        address: TEST_CONTRACT,
        args: [TEST_RECIPIENT, 100n],
        chainId: TEST_CHAIN_ID,
        functionName: "transfer",
      });

      const minedFiber = yield* Stream.runHead(
        Stream.filter(
          execution.stateRef.changes,
          (state): state is Extract<TxState, { status: "mined" }> => state.status === "mined"
        )
      ).pipe(Effect.forkScoped);

      const terminal = yield* execution.terminal;
      const mined = yield* Fiber.join(minedFiber);

      expect(terminal._tag).toBe("success");
      if (terminal._tag === "success") {
        expect(terminal.hash).toBe(TEST_ONCHAIN_HASH);
      }

      expect(Option.isSome(mined)).toBe(true);
      if (Option.isSome(mined)) {
        expect(mined.value.hash).toBe(TEST_ONCHAIN_HASH);
      }
    }).pipe(
      Effect.provide(
        makeAdapterRuntimeLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          })
        )
      ),
      Effect.scoped
    )
  );

  it.effect("success terminal includes decoded events from the receipt logs", () =>
    Effect.gen(function* () {
      safeWriteAndTrackOverride.impl = () =>
        Effect.gen(function* () {
          const stateRef = yield* SubscriptionRef.make<SafeWriteAndTrackState>({
            onchainHash: TEST_ONCHAIN_HASH,
            receipt: TEST_RECEIPT_WITH_LOG,
            safeTxHash: TEST_SAFE_TX_HASH,
            status: "success",
          });

          return {
            result: Effect.succeed({
              _tag: "success" as const,
              onchainHash: TEST_ONCHAIN_HASH,
              receipt: TEST_RECEIPT_WITH_LOG,
              safeTxHash: TEST_SAFE_TX_HASH,
            }),
            stateRef,
          } satisfies SafeWriteAndTrackResult;
        });

      const adapter = yield* WriteExecutionAdapter;

      const execution = yield* adapter.writeAndTrack({
        abi: erc20Abi,
        account: TEST_ACCOUNT,
        address: TEST_CONTRACT,
        args: [TEST_RECIPIENT, 100n],
        chainId: TEST_CHAIN_ID,
        functionName: "transfer",
      });

      const terminal = yield* execution.terminal;

      expect(terminal._tag).toBe("success");
      if (terminal._tag === "success") {
        expect(terminal.events).toHaveLength(1);
        expect(terminal.events[0]?.eventName).toBe("Transfer");
        expect(terminal.events[0]?.args).toMatchObject({
          from: TEST_ACCOUNT,
          to: TEST_RECIPIENT,
          value: 100n,
        });
      }
    }).pipe(
      Effect.provide(
        makeAdapterRuntimeLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          })
        )
      ),
      Effect.scoped
    )
  );

  it.effect("returns queued terminal and queued TxState", () =>
    Effect.gen(function* () {
      safeWriteAndTrackOverride.impl = () =>
        Effect.gen(function* () {
          const stateRef = yield* SubscriptionRef.make<SafeWriteAndTrackState>({
            confirmations: 1,
            confirmationsRequired: 2,
            lastStatus: "awaiting_confirmations",
            safeTxHash: TEST_SAFE_TX_HASH,
            status: "queued",
          });

          return {
            result: Effect.succeed({
              _tag: "queued" as const,
              confirmations: 1,
              confirmationsRequired: 2,
              lastStatus: "awaiting_confirmations" as const,
              onchainHash: null,
              safeTxHash: TEST_SAFE_TX_HASH,
            }),
            stateRef,
          } satisfies SafeWriteAndTrackResult;
        });

      const adapter = yield* WriteExecutionAdapter;

      const execution = yield* adapter.writeAndTrack({
        abi: erc20Abi,
        account: TEST_ACCOUNT,
        address: TEST_CONTRACT,
        args: [TEST_RECIPIENT, 100n],
        chainId: TEST_CHAIN_ID,
        functionName: "transfer",
      });

      const queuedFiber = yield* Stream.runHead(
        Stream.filter(
          execution.stateRef.changes,
          (state): state is Extract<TxState, { status: "queued" }> => state.status === "queued"
        )
      ).pipe(Effect.forkScoped);

      const terminal = yield* execution.terminal;
      const queued = yield* Fiber.join(queuedFiber);

      expect(terminal).toEqual({
        _tag: "queued",
        details: {
          confirmations: 1,
          confirmationsRequired: 2,
          lastStatus: "awaiting_confirmations",
        },
        reason: "awaiting-safe-confirmations",
        reference: TEST_SAFE_TX_HASH,
      });

      expect(Option.isSome(queued)).toBe(true);
      if (Option.isSome(queued)) {
        expect(queued.value).toEqual({
          details: {
            confirmations: 1,
            confirmationsRequired: 2,
            lastStatus: "awaiting_confirmations",
          },
          reason: "awaiting-safe-confirmations",
          reference: TEST_SAFE_TX_HASH,
          status: "queued",
        });
      }
    }).pipe(
      Effect.provide(
        makeAdapterRuntimeLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          })
        )
      ),
      Effect.scoped
    )
  );

  it.effect("returns cancelled terminal and cancelled TxState", () =>
    Effect.gen(function* () {
      safeWriteAndTrackOverride.impl = () =>
        Effect.gen(function* () {
          const stateRef = yield* SubscriptionRef.make<SafeWriteAndTrackState>({
            safeTxHash: TEST_SAFE_TX_HASH,
            status: "cancelled",
          });

          return {
            result: Effect.succeed({
              _tag: "cancelled" as const,
              onchainHash: null,
              safeTxHash: TEST_SAFE_TX_HASH,
            }),
            stateRef,
          } satisfies SafeWriteAndTrackResult;
        });

      const adapter = yield* WriteExecutionAdapter;

      const execution = yield* adapter.writeAndTrack({
        abi: erc20Abi,
        account: TEST_ACCOUNT,
        address: TEST_CONTRACT,
        args: [TEST_RECIPIENT, 100n],
        chainId: TEST_CHAIN_ID,
        functionName: "transfer",
      });

      const cancelledFiber = yield* Stream.runHead(
        Stream.filter(
          execution.stateRef.changes,
          (state): state is Extract<TxState, { status: "cancelled" }> =>
            state.status === "cancelled"
        )
      ).pipe(Effect.forkScoped);

      const terminal = yield* execution.terminal;
      const cancelled = yield* Fiber.join(cancelledFiber);

      expect(terminal).toEqual({
        _tag: "cancelled",
        reason: "safe-cancelled",
        reference: TEST_SAFE_TX_HASH,
      });

      expect(Option.isSome(cancelled)).toBe(true);
      if (Option.isSome(cancelled)) {
        expect(cancelled.value).toEqual({
          reason: "safe-cancelled",
          reference: TEST_SAFE_TX_HASH,
          status: "cancelled",
        });
      }
    }).pipe(
      Effect.provide(
        makeAdapterRuntimeLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          })
        )
      ),
      Effect.scoped
    )
  );

  it.effect("failed terminal prefers the on-chain hash over the Safe tx hash", () =>
    Effect.gen(function* () {
      safeWriteAndTrackOverride.impl = () =>
        Effect.gen(function* () {
          const stateRef = yield* SubscriptionRef.make<SafeWriteAndTrackState>({
            error: "Transaction reverted on-chain",
            onchainHash: TEST_ONCHAIN_HASH,
            safeTxHash: TEST_SAFE_TX_HASH,
            status: "failed",
          });

          return {
            result: Effect.succeed({
              _tag: "failed" as const,
              error: "Transaction reverted on-chain",
              onchainHash: TEST_ONCHAIN_HASH,
              safeTxHash: TEST_SAFE_TX_HASH,
            }),
            stateRef,
          } satisfies SafeWriteAndTrackResult;
        });

      const adapter = yield* WriteExecutionAdapter;

      const execution = yield* adapter.writeAndTrack({
        abi: erc20Abi,
        account: TEST_ACCOUNT,
        address: TEST_CONTRACT,
        args: [TEST_RECIPIENT, 100n],
        chainId: TEST_CHAIN_ID,
        functionName: "transfer",
      });

      // B1 ripple: a reverted Safe tx carries the real on-chain hash; both the
      // terminal error and the mapped TxState must link it, not the Safe tx hash.
      // The mocked TxFailedError (see the core/errors mock above) carries `hash`.
      const error = yield* execution.terminal.pipe(Effect.flip);
      expect(error).toMatchObject({ hash: TEST_ONCHAIN_HASH });

      const failedState = yield* Stream.runHead(
        Stream.filter(
          execution.stateRef.changes,
          (state): state is Extract<TxState, { status: "failed" }> => state.status === "failed"
        )
      );
      expect(Option.isSome(failedState)).toBe(true);
      if (Option.isSome(failedState)) {
        expect(failedState.value.error.hash).toBe(TEST_ONCHAIN_HASH);
      }
    }).pipe(
      Effect.provide(
        makeAdapterRuntimeLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          })
        )
      ),
      Effect.scoped
    )
  );

  it.effect("returns failed execution when calldata encoding fails", () =>
    Effect.gen(function* () {
      const adapter = yield* WriteExecutionAdapter;

      const execution = yield* adapter.writeAndTrack({
        abi: erc20Abi,
        account: TEST_ACCOUNT,
        address: TEST_CONTRACT,
        args: [TEST_RECIPIENT, -1n],
        chainId: TEST_CHAIN_ID,
        functionName: "transfer",
      });

      const exit = yield* execution.terminal.pipe(Effect.exit);
      const state = yield* execution.stateRef.get;

      expect(Exit.isFailure(exit)).toBe(true);
      expect(state.status).toBe("failed");
      if (state.status === "failed") {
        expect(state.error.message).toContain("encode");
      }
    }).pipe(
      Effect.provide(
        makeAdapterRuntimeLayer(() =>
          Effect.succeed({
            confirmations: 2,
            confirmationsRequired: 2,
            onchainHash: Option.some(TEST_ONCHAIN_HASH),
            status: "SUCCESS",
          })
        )
      ),
      Effect.scoped
    )
  );
});
