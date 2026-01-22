import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { GasLimitOverflowError, SafeSimulationFailedError } from "../errors.js";
import { evaluateSimulationResult } from "./evaluation/index.js";
import type { LatestBlock, SimulationDecoded } from "./types/index.js";

const block = { gasLimit: 1000n } as LatestBlock;

describe("evaluateSimulationResult", () => {
  it.effect("fails when gas exceeds threshold", () =>
    Effect.gen(function* () {
      const result: SimulationDecoded = { gas: 951n, success: true };
      const error = yield* evaluateSimulationResult(result, block).pipe(Effect.flip);
      expect(error).toBeInstanceOf(GasLimitOverflowError);
    })
  );

  it.effect("fails when simulation reports failure", () =>
    Effect.gen(function* () {
      const result: SimulationDecoded = { gas: 1n, success: false };
      const error = yield* evaluateSimulationResult(result, block).pipe(Effect.flip);
      expect(error).toBeInstanceOf(SafeSimulationFailedError);
    })
  );

  it.effect("returns estimate when within threshold", () =>
    Effect.gen(function* () {
      const result: SimulationDecoded = { gas: 900n, success: true };
      const output = yield* evaluateSimulationResult(result, block);
      expect(output).toEqual({ estimatedGas: 900n, success: true });
    })
  );
});
