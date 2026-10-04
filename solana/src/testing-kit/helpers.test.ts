import { describe, expect, it } from "@effect/vitest";
import { Cause, Exit, Result } from "effect";
import { assertFailure, assertSuccess, expectTaggedFailure } from "./helpers.js";

describe("native Result and Cause helpers", () => {
  it("returns the original failure and success values", () => {
    const error = { _tag: "Fixture" as const, message: "failure" };
    const value = { amount: 10n };
    expect(assertFailure(Result.fail(error))).toBe(error);
    expect(assertSuccess(Result.succeed(value))).toBe(value);
    expect(() => assertFailure(Result.succeed(value))).toThrow();
    expect(() => assertSuccess(Result.fail(error))).toThrow();
  });

  it("selects the first typed failure in a mixed Cause", () => {
    const first = { _tag: "First" as const };
    const second = { _tag: "Second" as const };
    const exit = Exit.failCause(
      Cause.fromReasons<typeof first | typeof second>([
        Cause.makeDieReason(new Error("defect")),
        Cause.makeInterruptReason(),
        Cause.makeFailReason(first),
        Cause.makeFailReason(second),
      ])
    );
    expect(() => expectTaggedFailure(exit, "First")).not.toThrow();
    expect(() => expectTaggedFailure(exit, "Second")).toThrow();
    expect(() =>
      expectTaggedFailure<typeof first>(Exit.failCause(Cause.interrupt()), "First")
    ).toThrow();
  });
});
