import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { SpanNames, withSpan } from "#src/telemetry/index.js";

describe("tracer", () => {
  describe("withSpan", () => {
    it.effect("wraps effect without changing result", () =>
      Effect.gen(function* () {
        const effect = Effect.succeed(42);
        const wrapped = withSpan("test.operation")(effect);
        const result = yield* wrapped;
        expect(result).toBe(42);
      })
    );

    it.effect("preserves error propagation", () =>
      Effect.gen(function* () {
        const effect = Effect.fail(new Error("test error"));
        const wrapped = withSpan("test.operation")(effect);
        const exit = yield* Effect.exit(wrapped);

        expect(exit._tag).toBe("Failure");
      })
    );

    it.effect("accepts attributes parameter", () =>
      Effect.gen(function* () {
        const effect = Effect.succeed("result");
        const wrapped = withSpan("test.operation", {
          attr1: "value1",
          attr2: 123,
        })(effect);
        const result = yield* wrapped;
        expect(result).toBe("result");
      })
    );

    it.effect("works without attributes parameter", () =>
      Effect.gen(function* () {
        const effect = Effect.succeed("result");
        const wrapped = withSpan("test.operation")(effect);
        const result = yield* wrapped;
        expect(result).toBe("result");
      })
    );
  });

  describe("SpanNames", () => {
    it("CONTRACT_READ equals ew3.contract.read", () => {
      expect(SpanNames.CONTRACT_READ).toBe("ew3.contract.read");
    });

    it("CONTRACT_WRITE equals ew3.contract.write", () => {
      expect(SpanNames.CONTRACT_WRITE).toBe("ew3.contract.write");
    });

    it("TX_WAIT equals ew3.tx.wait", () => {
      expect(SpanNames.TX_WAIT).toBe("ew3.tx.wait");
    });

    it("WALLET_CONNECT equals ew3.wallet.connect", () => {
      expect(SpanNames.WALLET_CONNECT).toBe("ew3.wallet.connect");
    });

    it("has all expected span name constants", () => {
      const expectedKeys = [
        "CONTRACT_READ",
        "CONTRACT_WRITE",
        "CONTRACT_SIMULATE",
        "CONTRACT_ESTIMATE_GAS",
        "MULTICALL",
        "TX_WAIT",
        "TX_TRACK",
        "EVENT_WATCH",
        "EVENT_BACKFILL",
        "WALLET_CONNECT",
        "WALLET_SIGN_MESSAGE",
        "WALLET_SIGN_TYPED_DATA",
        "ENS_GET_ADDRESS",
        "ENS_GET_AVATAR",
        "ENS_GET_NAME",
        "ENS_GET_RESOLVER",
        "ENS_GET_TEXT",
      ];

      const actualKeys = Object.keys(SpanNames);
      expect(actualKeys.length).toBeGreaterThanOrEqual(expectedKeys.length);

      for (const key of expectedKeys) {
        expect(SpanNames).toHaveProperty(key);
        expect(typeof SpanNames[key as keyof typeof SpanNames]).toBe("string");
      }
    });
  });
});
