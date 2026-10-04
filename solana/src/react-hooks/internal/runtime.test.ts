import { Cause, Context, Effect, Exit, Fiber, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { fromCause } from "./error.js";
import { buildRuntime, buildRuntimeSync, closeRuntime } from "./runtime.js";
import { makeScopedRun } from "./scoped-run.js";

describe("react-hooks runtime", () => {
  it.each([
    "failure",
    "defect",
  ] as const)("releases partial async acquisition before rejecting the original %s", async (failure) => {
    const error = new Error("layer acquisition failed");
    const finalizing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const settled = vi.fn();
    let released = false;
    const layer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.promise(async () => {
            finalizing.resolve();
            await release.promise;
            released = true;
          })
        );
        yield* Effect.promise(() => Promise.resolve());
        return yield* failure === "failure" ? Effect.fail(error) : Effect.die(error);
      })
    );
    const rejected = buildRuntime(layer).catch((cause) => {
      settled();
      return cause;
    });
    try {
      await finalizing.promise;
      expect(settled).not.toHaveBeenCalled();
      expect(released).toBe(false);
    } finally {
      release.resolve();
    }
    expect(await rejected).toBe(error);
    expect(released).toBe(true);
  });

  it("preserves the build failure when a resource finalizer defects", async () => {
    const error = new Error("build failed");
    const released = vi.fn();
    const layer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.sync(released).pipe(Effect.andThen(Effect.die(new Error("finalizer failed"))))
        );
        return yield* Effect.fail(error);
      })
    );
    await expect(buildRuntime(layer)).rejects.toBe(error);
    expect(released).toHaveBeenCalledOnce();
  });

  it("does not acquire a layer with an already-aborted signal", async () => {
    const controller = new AbortController();
    const acquire = vi.fn();
    controller.abort();
    await expect(
      buildRuntime(Layer.effectDiscard(Effect.sync(acquire)), { signal: controller.signal })
    ).rejects.toThrow();
    expect(acquire).not.toHaveBeenCalled();
  });

  it("aborts pending acquisition and waits for its delayed resource finalizer", async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const finalizing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const interrupted = vi.fn();
    const settled = vi.fn();
    const layer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.promise(() => {
            finalizing.resolve();
            return release.promise;
          })
        );
        yield* Effect.callback<void>(() => {
          started.resolve();
          return Effect.sync(interrupted);
        });
      })
    );
    const rejected = buildRuntime(layer, { signal: controller.signal }).catch((cause) => {
      settled();
      return cause;
    });
    try {
      await started.promise;
      controller.abort();
      await finalizing.promise;
      expect(interrupted).toHaveBeenCalledOnce();
      expect(settled).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      release.resolve();
    }
    expect(await rejected).toBeInstanceOf(Error);
    expect(settled).toHaveBeenCalledOnce();
  });

  it("runPromiseExit returns Success on success effects", async () => {
    const runtime = buildRuntimeSync(Layer.empty);
    const exit = await runtime.runPromiseExit(Effect.succeed(123));
    await closeRuntime(runtime.scope);

    expect(exit._tag).toBe("Success");
    if (exit._tag === "Success") {
      expect(exit.value).toBe(123);
    }
  });

  it("runPromiseExit returns Failure on failed effects", async () => {
    const runtime = buildRuntimeSync(Layer.empty);
    const exit = await runtime.runPromiseExit(Effect.fail("nope"));
    await closeRuntime(runtime.scope);

    expect(exit._tag).toBe("Failure");
  });

  it.each([
    buildRuntime,
    buildRuntimeSync,
  ])("exposes native context and preserves failures and defects with %s", async (build) => {
    const Service = Context.Service<{ readonly value: number }>("runtime-test-service");
    const runtime = await build(Layer.succeed(Service, { value: 7 }));
    try {
      expect(Effect.runSyncWith(runtime.context)(Service)).toEqual({ value: 7 });
      const error = new Error("expected failure");
      await expect(runtime.runPromise(Effect.fail(error))).rejects.toBe(error);
      const failure = await runtime.runPromiseExit(Effect.fail(error));
      expect(Exit.isFailure(failure)).toBe(true);
      if (Exit.isFailure(failure)) expect(fromCause(failure.cause)).toBe(error);

      const defect = await runtime.runPromiseExit(Effect.die(error));
      expect(Exit.isFailure(defect)).toBe(true);
      if (Exit.isFailure(defect)) {
        expect(Option.isNone(Cause.findErrorOption(defect.cause))).toBe(true);
        expect(fromCause(defect.cause)).toBe(defect.cause);
      }
    } finally {
      await closeRuntime(runtime.scope);
    }
  });

  it.each([
    "child",
    "parent",
  ] as const)("does not start work when the %s scope closes before fork", async (owner) => {
    const runtime = buildRuntimeSync(Layer.empty);
    const pending = makeScopedRun(runtime);
    if (owner === "parent") await closeRuntime(runtime.scope);
    const scoped = await pending;
    if (owner === "child") scoped.close();
    const work = vi.fn();
    const fiber = scoped.fork(Effect.sync(work));
    const exit = await runtime.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.hasInterrupts(exit.cause)).toBe(true);
    expect(work).not.toHaveBeenCalled();
    await closeRuntime(runtime.scope);
  });

  it("interrupts a hook fiber and waits for its delayed finalizer when its parent closes", async () => {
    const runtime = buildRuntimeSync(Layer.empty);
    const scoped = await makeScopedRun(runtime);
    const started = Promise.withResolvers<void>();
    const finalizing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const fiber = scoped.fork(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => {
            finalizing.resolve();
            return release.promise;
          })
        );
        started.resolve();
        yield* Effect.never;
      })
    );
    await started.promise;
    let closed = false;
    const closing = closeRuntime(runtime.scope).then(() => {
      closed = true;
    });
    try {
      await finalizing.promise;
      expect(closed).toBe(false);
    } finally {
      release.resolve();
      await closing;
    }
    const exit = await runtime.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it.each([
    "synchronous",
    "asynchronous",
  ] as const)("interrupts rejected layer acquisition with %s finalizers", async (finalizer) => {
    const releaseGate = Promise.withResolvers<void>();
    let released = false;
    let interrupted = false;
    const layer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.gen(function* () {
            if (finalizer === "asynchronous") yield* Effect.promise(() => releaseGate.promise);
            released = true;
          })
        );
        yield* Effect.callback<void>(() =>
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
      expect(String(failure)).toContain("An asynchronous Effect was executed with Effect.runSync");
      await vi.waitFor(() => {
        expect(interrupted).toBe(true);
      });
      if (finalizer === "asynchronous") expect(released).toBe(false);
      releaseGate.resolve();
      await vi.waitFor(() => expect(released).toBe(true));
    } finally {
      releaseGate.resolve();
    }
  });
});
