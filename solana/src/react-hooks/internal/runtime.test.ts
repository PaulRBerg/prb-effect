import { Cause, Effect, Fiber, Layer, Runtime } from "effect";
import { describe, expect, it, vi } from "vitest";
import { buildRuntimeSync } from "./runtime.js";

describe("react-hooks runtime", () => {
  it.each([
    "synchronous",
    "asynchronous",
  ] as const)("interrupts rejected layer acquisition with %s finalizers", async (finalizer) => {
    const releaseGate = Promise.withResolvers<void>();
    let released = false;
    let interrupted = false;
    const layer = Layer.scopedDiscard(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.gen(function* () {
            if (finalizer === "asynchronous") yield* Effect.promise(() => releaseGate.promise);
            released = true;
          })
        );
        yield* Effect.async<void>(() =>
          Effect.sync(() => {
            interrupted = true;
          })
        );
      })
    );
    let failure: unknown;
    try {
      buildRuntimeSync(layer);
    } catch (cause) {
      failure = cause;
    }
    try {
      expect(String(failure)).toContain("cannot be resolved synchronously");
      await vi.waitFor(() => {
        expect(interrupted).toBe(true);
      });
      if (finalizer === "asynchronous") expect(released).toBe(false);
      releaseGate.resolve();
      await vi.waitFor(() => expect(released).toBe(true));
    } finally {
      releaseGate.resolve();
      // Release the rejected build even when this regression fails against the old implementation.
      if (Runtime.isFiberFailure(failure)) {
        for (const defect of Cause.defects(failure[Runtime.FiberFailureCauseId])) {
          if (Runtime.isAsyncFiberException(defect))
            await Effect.runPromise(Fiber.interrupt(defect.fiber));
        }
      }
    }
  });
});
