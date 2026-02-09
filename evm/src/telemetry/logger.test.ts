import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  logContractRead,
  logContractWrite,
  logError,
  logEventReceived,
  logTxLifecycle,
} from "#src/telemetry/index.js";
import { TEST_ADDRESS, TEST_CHAIN_ID, TEST_TX_HASH } from "#src/testing-kit/index.js";

describe("logger", () => {
  describe("logContractRead", () => {
    it.effect("completes successfully with params", () =>
      Effect.gen(function* () {
        const effect = logContractRead({
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          functionName: "balanceOf",
        });
        yield* effect;
        // If we reach here, the effect succeeded
        expect(true).toBe(true);
      })
    );

    it.effect("returns Effect<void>", () =>
      Effect.gen(function* () {
        const effect = logContractRead({
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          functionName: "totalSupply",
        });
        const result = yield* effect;
        expect(result).toBeUndefined();
      })
    );
  });

  describe("logContractWrite", () => {
    it.effect("completes successfully with params", () =>
      Effect.gen(function* () {
        const effect = logContractWrite({
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });
        yield* effect;
        expect(true).toBe(true);
      })
    );

    it.effect("handles optional hash parameter", () =>
      Effect.gen(function* () {
        const effect = logContractWrite({
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          hash: TEST_TX_HASH,
        });
        yield* effect;
        expect(true).toBe(true);
      })
    );

    it.effect("works without hash parameter", () =>
      Effect.gen(function* () {
        const effect = logContractWrite({
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          functionName: "approve",
        });
        const result = yield* effect;
        expect(result).toBeUndefined();
      })
    );
  });

  describe("logTxLifecycle", () => {
    it.effect("completes with status and hash", () =>
      Effect.gen(function* () {
        const effect = logTxLifecycle({
          hash: TEST_TX_HASH,
          status: "submitted",
        });
        yield* effect;
        expect(true).toBe(true);
      })
    );

    it.effect("handles optional confirmations", () =>
      Effect.gen(function* () {
        const effect = logTxLifecycle({
          confirmations: 12,
          hash: TEST_TX_HASH,
          status: "mined",
        });
        yield* effect;
        expect(true).toBe(true);
      })
    );

    it.effect("works without confirmations parameter", () =>
      Effect.gen(function* () {
        const effect = logTxLifecycle({
          hash: TEST_TX_HASH,
          status: "pending",
        });
        const result = yield* effect;
        expect(result).toBeUndefined();
      })
    );
  });

  describe("logEventReceived", () => {
    it.effect("handles bigint blockNumber", () =>
      Effect.gen(function* () {
        const effect = logEventReceived({
          address: TEST_ADDRESS,
          blockNumber: 1000n,
          eventName: "Transfer",
        });
        yield* effect;
        expect(true).toBe(true);
      })
    );

    it.effect("completes successfully with all params", () =>
      Effect.gen(function* () {
        const effect = logEventReceived({
          address: TEST_ADDRESS,
          blockNumber: 123456n,
          eventName: "Approval",
        });
        const result = yield* effect;
        expect(result).toBeUndefined();
      })
    );
  });

  describe("logError", () => {
    it.effect("completes with operation and error", () =>
      Effect.gen(function* () {
        const effect = logError({
          error: new Error("test error"),
          operation: "contract.read",
        });
        yield* effect;
        expect(true).toBe(true);
      })
    );

    it.effect("handles different error types", () =>
      Effect.gen(function* () {
        const effect = logError({
          error: "string error",
          operation: "contract.write",
        });
        const result = yield* effect;
        expect(result).toBeUndefined();
      })
    );
  });

  describe("composition", () => {
    it.effect("functions can be composed with Effect.tap", () =>
      Effect.gen(function* () {
        const mainEffect = Effect.succeed(42);

        const composed = mainEffect.pipe(
          Effect.tap(() =>
            logContractRead({
              address: TEST_ADDRESS,
              chainId: TEST_CHAIN_ID,
              functionName: "balanceOf",
            })
          )
        );

        const result = yield* composed;
        expect(result).toBe(42);
      })
    );
  });
});
