import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Address, Hex } from "viem";
import { InvalidGasThresholdError, SafeMultisigSimulationFailedError } from "../errors.js";
import type { SafeMultisigSimulateBatchParams } from "../types.js";
import { validateSimulationParams } from "./validation/index.js";

const baseParams: SafeMultisigSimulateBatchParams = {
  chainId: 1,
  safeAddress: "0x0000000000000000000000000000000000000001" as Address,
  transactions: [
    {
      data: "0x" as Hex,
      to: "0x0000000000000000000000000000000000000002" as Address,
      value: 0n,
    },
  ],
};

describe("validateSimulationParams", () => {
  it.effect("fails on empty transaction batch", () =>
    Effect.gen(function* () {
      const error = yield* validateSimulationParams({
        ...baseParams,
        transactions: [],
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(SafeMultisigSimulationFailedError);
    })
  );

  it.effect("fails on zero Safe address", () =>
    Effect.gen(function* () {
      const error = yield* validateSimulationParams({
        ...baseParams,
        safeAddress: "0x0000000000000000000000000000000000000000" as Address,
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(SafeMultisigSimulationFailedError);
    })
  );

  it.effect("fails on out-of-range gas threshold", () =>
    Effect.gen(function* () {
      const error = yield* validateSimulationParams({
        ...baseParams,
        gasThresholdPercent: 101,
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(InvalidGasThresholdError);
    })
  );

  it.effect("passes for valid inputs", () =>
    Effect.gen(function* () {
      const result = yield* validateSimulationParams(baseParams);
      expect(result).toEqual(baseParams);
    })
  );
});
