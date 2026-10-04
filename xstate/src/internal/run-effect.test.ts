import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { vi } from "vitest";
import { runEffect } from "./run-effect.js";

describe("internal/runEffect", () => {
  it("preserves typed failure identity", async () => {
    class Failed extends Schema.TaggedError<Failed>()("Failed", {
      message: Schema.String,
    }) {}
    const error = new Failed({ message: "failed" });

    await expect(runEffect(Effect.fail(error), new AbortController().signal)).rejects.toBe(error);
  });

  it("preserves defect identity", async () => {
    const defect = new Error("defect");

    await expect(runEffect(Effect.die(defect), new AbortController().signal)).rejects.toBe(defect);
  });

  it("interrupts pending work and completes its finalizer on abort", async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const finalized = vi.fn();
    const result = runEffect(
      Effect.sync(() => started.resolve()).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(Effect.sync(finalized))
      ),
      controller.signal
    );
    const rejected = expect(result).rejects.toBeInstanceOf(Error);

    await started.promise;
    controller.abort();
    await rejected;
    expect(finalized).toHaveBeenCalledOnce();
  });
});
