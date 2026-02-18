import { describe, expect, it } from "@effect/vitest";
import { WriteExecutionAdapter } from "@prb/effect-evm/contract/pipeline";
import type { TxState } from "@prb/effect-evm/tx";
import { TxManager } from "@prb/effect-evm/tx";
import { Effect, Exit, Fiber, Layer, Option, Stream } from "effect";
import type { Hash, Hex, TransactionReceipt } from "viem";
import { erc20Abi } from "viem";
import { vi } from "vitest";
import { SafeWriteExecutionAdapterLive } from "./pipeline-adapter.js";
import type { SafeAppsServiceShape } from "./service.js";
import { SafeAppsService } from "./service.js";

vi.mock(
  "@prb/effect-evm/contract/pipeline",
  async () => import("../../../evm/src/contract/pipeline/adapter.js")
);

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

      const final = yield* execution.result;
      const mined = yield* Fiber.join(minedFiber);

      expect(final.hash).toBe(TEST_ONCHAIN_HASH);
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

      const exit = yield* execution.result.pipe(Effect.exit);
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
