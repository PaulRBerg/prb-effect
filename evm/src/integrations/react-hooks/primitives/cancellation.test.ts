import { Effect, Exit, Layer, Scope, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRuntimeSync, closeRuntime } from "../internal/runtime.js";
import type { ScopedRun } from "../internal/scoped-run.js";

const mocks = vi.hoisted(() => ({
  effects: [] as Array<() => (() => void) | undefined>,
  makeScopedRun: vi.fn<() => Promise<ScopedRun>>(),
  runtime: undefined as ReturnType<typeof buildRuntimeSync> | undefined,
}));

vi.mock("react", () => ({
  startTransition: (run: () => void) => run(),
  useEffect: (effect: () => (() => void) | undefined) => mocks.effects.push(effect),
  useRef: <T>(value: T) => ({ current: value }),
  useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock("../provider.js", () => ({ useEffectEvmRuntime: () => mocks.runtime }));
vi.mock("../internal/scoped-run.js", () => ({ makeScopedRun: mocks.makeScopedRun }));

const { useEffectOnce, useEffectMemo } = await import("./use-effect.js");
const { useForkEffect } = await import("./use-fork-effect.js");
const { useStream, useStreamEffect } = await import("./use-stream.js");
const { useEffectMemoFactory } = await import("./use-effect-memo-factory.js");

beforeEach(() => {
  mocks.effects.length = 0;
  mocks.makeScopedRun.mockReset();
  mocks.runtime = buildRuntimeSync(Layer.empty);
});

afterEach(async () => {
  if (mocks.runtime) {
    await closeRuntime(mocks.runtime.scope);
  }
});

describe("hook cancellation", () => {
  it.each([
    ["useEffectOnce", (factory: () => Effect.Effect<void>) => useEffectOnce(factory)],
    ["useEffectMemo", (factory: () => Effect.Effect<void>) => useEffectMemo(factory, [])],
    ["useForkEffect", (factory: () => Effect.Effect<void>) => useForkEffect(factory, [])],
    [
      "useStream",
      (factory: () => Effect.Effect<void>) => useStream(Stream.fromEffect(Effect.suspend(factory))),
    ],
    [
      "useStreamEffect",
      (factory: () => Effect.Effect<void>) =>
        useStreamEffect(() => factory().pipe(Effect.as(Stream.empty)), []),
    ],
    [
      "useEffectMemoFactory",
      (factory: () => Effect.Effect<void>) => useEffectMemoFactory(factory, []),
    ],
  ] as const)("%s closes a late scope without starting work", async (_name, render) => {
    const gate = Promise.withResolvers<ScopedRun>();
    mocks.makeScopedRun.mockReturnValueOnce(gate.promise);
    const factory = vi.fn(() => Effect.void);
    const fork = vi.fn();
    const close = vi.fn();
    const scope = Effect.runSync(Scope.make());
    render(factory);
    const cleanup = mocks.effects[0]?.();
    cleanup?.();
    gate.resolve({ close, fork, scope });
    await gate.promise;
    expect(close).toHaveBeenCalledOnce();
    expect(fork).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("useStreamEffect interrupts stream acquisition during cleanup", async () => {
    const runtime = mocks.runtime;
    if (!runtime) {
      throw new Error("Test runtime was not initialized");
    }
    const scope = Effect.runSync(Scope.make());
    const closed = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const finalized = vi.fn();
    let resumeFactory: ((effect: Effect.Effect<Stream.Stream<never>>) => void) | undefined;
    const scoped: ScopedRun = {
      close: () => {
        void runtime.runPromise(Scope.close(scope, Exit.void)).then(closed.resolve);
      },
      fork: (effect) =>
        Effect.runSyncWith(runtime.context)(Effect.forkIn(Scope.provide(effect, scope), scope)),
      scope,
    };
    mocks.makeScopedRun.mockResolvedValueOnce(scoped);
    useStreamEffect(
      () =>
        Effect.callback<Stream.Stream<never>>((resume) => {
          resumeFactory = resume;
          started.resolve();
          return Effect.sync(finalized);
        }),
      []
    );
    const cleanup = mocks.effects[0]?.();
    try {
      await started.promise;
      cleanup?.();
      await closed.promise;
      expect(finalized).toHaveBeenCalledOnce();
    } finally {
      resumeFactory?.(Effect.succeed(Stream.empty));
      cleanup?.();
    }
  });
});
