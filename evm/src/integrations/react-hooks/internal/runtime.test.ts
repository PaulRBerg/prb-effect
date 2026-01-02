import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { buildRuntimeSync } from "./runtime.js";

describe("react-hooks runtime", () => {
  it("runPromiseExit returns Success on success effects", async () => {
    const runtime = buildRuntimeSync(Layer.empty);
    const exit = await runtime.runPromiseExit(Effect.succeed(123));

    expect(exit._tag).toBe("Success");
    if (exit._tag === "Success") {
      expect(exit.value).toBe(123);
    }
  });

  it("runPromiseExit returns Failure on failed effects", async () => {
    const runtime = buildRuntimeSync(Layer.empty);
    const exit = await runtime.runPromiseExit(Effect.fail("nope"));

    expect(exit._tag).toBe("Failure");
  });
});
