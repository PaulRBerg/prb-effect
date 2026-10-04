import { Effect, Exit, Layer, Scope, Stream } from "effect";
import type { Abi } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContractPipeline } from "#src/contract/index.js";
import type { EffectEvmRuntime } from "../internal/runtime.js";
import { buildRuntimeSync, closeRuntime } from "../internal/runtime.js";
import type { ScopedRun } from "../internal/scoped-run.js";

const mocks = vi.hoisted(() => ({
  effects: [] as Array<() => (() => void) | undefined>,
  makeScopedRun: vi.fn<() => Promise<ScopedRun>>(),
  runtime: undefined as EffectEvmRuntime | undefined,
  watchStream: vi.fn(),
}));
vi.mock("react", () => ({
  useCallback: (value: unknown) => value,
  useEffect: (effect: () => (() => void) | undefined) => mocks.effects.push(effect),
  useMemo: (factory: () => unknown) => factory(),
  useRef: <T>(value: T) => ({ current: value }),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock("../provider.js", () => ({ useEffectEvmRuntime: () => mocks.runtime }));
vi.mock("../internal/scoped-run.js", () => ({ makeScopedRun: mocks.makeScopedRun }));
vi.mock("../primitives.js", () => ({
  useEffectMemo: vi.fn(),
  useStreamEffect: mocks.watchStream,
  useStream: () => ({ status: "starting" }),
}));
const { useWriteAndTrack, useWatchContractRead } = await import("./index.js");

const address = "0x0000000000000000000000000000000000000001";
const params = {
  abi: [] as Abi,
  account: address,
  address,
  chainId: 1,
  functionName: "write",
} as const;
const writeAndTrack = vi.fn<() => Effect.Effect<never>>();

beforeEach(() => {
  mocks.effects.length = 0;
  mocks.makeScopedRun.mockReset();
  mocks.watchStream.mockReset();
  writeAndTrack.mockReset();
  writeAndTrack.mockReturnValue(Effect.never);
  mocks.runtime = buildRuntimeSync(
    Layer.succeed(ContractPipeline, {
      writeAndTrack,
      writeAndWait: () => Effect.never,
    })
  );
});
afterEach(async () => {
  if (mocks.runtime) await closeRuntime(mocks.runtime.scope);
});

function makeScope(runtime: EffectEvmRuntime) {
  const scope = Effect.runSync(Scope.make());
  const closed = Promise.withResolvers<void>();
  const close = vi.fn(() => {
    void runtime.runPromise(Scope.close(scope, Exit.void)).then(closed.resolve);
  });
  const scoped: ScopedRun = {
    close,
    scope,
    fork: (effect) =>
      Effect.runSyncWith(runtime.context)(Effect.forkIn(Scope.provide(effect, scope), scope)),
  };
  return { closed: closed.promise, close, scoped };
}

describe("contract hook ownership", () => {
  it.each([
    "unmount",
    "new send",
  ] as const)("does not start a late write after %s", async (stop) => {
    const runtime = mocks.runtime;
    if (!runtime) throw new Error("Missing test runtime");
    const gate = Promise.withResolvers<ScopedRun>();
    const secondGate = Promise.withResolvers<ScopedRun>();
    const first = makeScope(runtime);
    const second = makeScope(runtime);
    mocks.makeScopedRun.mockReturnValueOnce(gate.promise).mockReturnValueOnce(secondGate.promise);
    const api = useWriteAndTrack(params);
    const cleanup = mocks.effects[0]?.();
    try {
      api.send();
      if (stop === "unmount") cleanup?.();
      else api.send();
      gate.resolve(first.scoped);
      await gate.promise;
      expect(first.close).toHaveBeenCalledOnce();
      expect(writeAndTrack).not.toHaveBeenCalled();
    } finally {
      cleanup?.();
      secondGate.resolve(second.scoped);
      await secondGate.promise;
      first.close();
      second.close();
    }
  });

  it("interrupts pending pipeline startup on unmount", async () => {
    const runtime = mocks.runtime;
    if (!runtime) throw new Error("Missing test runtime");
    const started = Promise.withResolvers<void>();
    const finalized = vi.fn();
    let resume: ((effect: Effect.Effect<never>) => void) | undefined;
    writeAndTrack.mockReturnValue(
      Effect.callback<never>((callback) => {
        resume = callback;
        started.resolve();
        return Effect.sync(finalized);
      })
    );
    const { scoped, closed } = makeScope(runtime);
    mocks.makeScopedRun.mockResolvedValueOnce(scoped);
    const api = useWriteAndTrack(params);
    const cleanup = mocks.effects[0]?.();
    try {
      api.send();
      await started.promise;
      cleanup?.();
      await closed;
      expect(finalized).toHaveBeenCalledOnce();
    } finally {
      resume?.(Effect.interrupt);
      cleanup?.();
    }
  });

  it("restarts watch reads when the refetch stream changes", () => {
    const first = Stream.empty;
    const second = Stream.make(undefined);
    useWatchContractRead(params, { refetchOn: first });
    useWatchContractRead(params, { refetchOn: second });
    const firstDeps = mocks.watchStream.mock.calls[0]?.[1];
    const secondDeps = mocks.watchStream.mock.calls[1]?.[1];
    expect(firstDeps).toContain(first);
    expect(secondDeps).toContain(second);
  });
});
