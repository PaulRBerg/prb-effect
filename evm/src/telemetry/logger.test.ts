import { describe, expect, it } from "@effect/vitest";
import { Effect, Logger, References } from "effect";
import {
  logContractRead,
  logContractWrite,
  logError,
  logEventReceived,
  logTxLifecycle,
} from "#src/telemetry/index.js";
import { TEST_ADDRESS, TEST_CHAIN_ID, TEST_TX_HASH } from "#src/testing-kit/index.js";

describe("logger", () => {
  it.effect("emits operation messages, levels, and fields", () => {
    const entries: { level: string; message: unknown }[] = [];
    const logger = Logger.make(({ logLevel, message }) => {
      entries.push({ level: logLevel, message });
    });
    const read = { address: TEST_ADDRESS, chainId: TEST_CHAIN_ID, functionName: "balanceOf" };
    const write = { ...read, functionName: "transfer" };
    const submitted = { hash: TEST_TX_HASH, status: "submitted" };
    const mined = { confirmations: 12, hash: TEST_TX_HASH, status: "mined" };
    const event = { address: TEST_ADDRESS, blockNumber: 1000n, eventName: "Transfer" };
    const failure = { error: new Error("test error"), operation: "contract.read" };
    const stringFailure = { error: "string error", operation: "contract.write" };

    return Effect.gen(function* () {
      yield* logContractRead(read);
      yield* logContractWrite(write);
      yield* logContractWrite({ ...write, hash: TEST_TX_HASH });
      yield* logTxLifecycle(submitted);
      yield* logTxLifecycle(mined);
      yield* logEventReceived(event);
      yield* logError(failure);
      yield* logError(stringFailure);

      expect(entries).toEqual([
        { level: "Debug", message: ["Contract read", read] },
        { level: "Info", message: ["Contract write", write] },
        { level: "Info", message: ["Contract write", { ...write, hash: TEST_TX_HASH }] },
        { level: "Debug", message: ["Transaction lifecycle", submitted] },
        { level: "Debug", message: ["Transaction lifecycle", mined] },
        { level: "Debug", message: ["Event received", event] },
        { level: "Error", message: ["Operation failed", failure] },
        { level: "Error", message: ["Operation failed", stringFailure] },
      ]);
    }).pipe(
      Effect.provide(Logger.layer([logger])),
      Effect.provideService(References.MinimumLogLevel, "All")
    );
  });
});
