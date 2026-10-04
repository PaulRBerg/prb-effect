import { describe, expect, it } from "@effect/vitest";
import { Cause, Exit } from "effect";
import { assertLeft, assertRight, expectDefect, expectTaggedFailure } from "./helpers.js";

describe("testing-kit Cause helpers", () => {
  it("selects the first typed failure while retaining defects in mixed causes", () => {
    const first = { _tag: "First" as const, message: "first" };
    const second = { _tag: "Second" as const, message: "second" };
    const defect = new Error("defect");
    const exit = Exit.failCause(
      Cause.fromReasons<typeof first | typeof second>([
        Cause.makeDieReason(defect),
        Cause.makeFailReason(first),
        Cause.makeInterruptReason(),
        Cause.makeFailReason(second),
      ])
    );
    expect(assertLeft(exit)).toBe(first);
    expect(() => expectTaggedFailure(exit, "First")).not.toThrow();
    expect(() => expectTaggedFailure(exit, "Second")).toThrow('got "First"');
    expect(() => expectDefect(exit, (value) => value === defect)).not.toThrow();
    expect(() => assertRight(exit)).toThrow("defect");
  });

  it("does not turn interruption-only exits into typed failures or defects", () => {
    const exit = Exit.failCause(Cause.interrupt());
    expect(() => assertLeft(exit)).toThrow("Expected Left with failures");
    expect(() => expectDefect(exit, () => true)).toThrow("without defects");
    expect(() => assertRight(exit)).toThrow("Expected Success");
  });
});
