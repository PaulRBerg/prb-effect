import { describe, expect, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Result } from "effect";
import { ClientNotFoundError } from "#src/core/index.js";
import {
  assertFailure,
  assertSuccess,
  expectTaggedFailure,
  makeMockServiceLayer,
} from "./helpers.js";

describe("Result assertions", () => {
  it("returns native Result values and rejects the opposite outcome", () => {
    const error = new Error("expected failure");
    expect(assertFailure(Result.fail(error))).toBe(error);
    expect(assertSuccess(Result.succeed(42))).toBe(42);
    expect(() => assertFailure(Result.succeed(42))).toThrow();
    expect(() => assertSuccess(Result.fail(error))).toThrow();
  });

  it("finds typed errors among flattened cause reasons", () => {
    const error = new ClientNotFoundError({ chainId: 1, message: "missing client" });
    const cause = Cause.fromReasons([Cause.makeDieReason("defect"), Cause.makeFailReason(error)]);
    expectTaggedFailure(Exit.failCause(cause), "ClientNotFoundError");
  });
});

describe("makeMockServiceLayer", () => {
  it.effect("accepts a native context key and maps merged overrides", () => {
    const Service = Context.Service<{ readonly value: number }>("testing-kit/Example");
    const layer = makeMockServiceLayer(
      Service,
      { base: 2, multiplier: 3 },
      { multiplier: 5 },
      (merged) => ({ value: merged.base * merged.multiplier })
    );
    return Effect.gen(function* () {
      const service = yield* Service;
      expect(service.value).toBe(10);
    }).pipe(Effect.provide(layer));
  });
});
