import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { vi } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

const { RequestTimingMiddleware, makeRequestTimingMiddleware } = await import("./index.js");

describe("request timing middleware", () => {
  it("calls onStart and onFinish with timing info", async () => {
    const startCalls: Array<{ props: unknown; startTimeMs: number }> = [];
    const finishCalls: Array<{
      props: unknown;
      startTimeMs: number;
      endTimeMs: number;
      durationMs: number;
      success: boolean;
      error?: unknown;
    }> = [];

    let nowValue = 100;
    const now = () => {
      const value = nowValue;
      nowValue += 50;
      return value;
    };

    const layer = makeRequestTimingMiddleware({
      now,
      onFinish: (context) =>
        Effect.sync(() => {
          finishCalls.push(context);
        }),
      onStart: (context) =>
        Effect.sync(() => {
          startCalls.push(context);
        }),
    });

    const program = Effect.gen(function* () {
      const middleware = yield* RequestTimingMiddleware;
      return yield* middleware({ next: Effect.succeed("ok"), props: { id: 1 } });
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result).toBe("ok");
    expect(startCalls).toHaveLength(1);
    expect(finishCalls).toHaveLength(1);
    expect(finishCalls[0]?.durationMs).toBe(50);
    expect(finishCalls[0]?.props).toEqual({ id: 1 });
    expect(finishCalls[0]?.success).toBe(true);
  });

  it("calls onFinish on failures", async () => {
    const finishCalls: Array<{ success: boolean; error?: unknown }> = [];

    const layer = makeRequestTimingMiddleware({
      onFinish: (context) =>
        Effect.sync(() => {
          finishCalls.push({ error: context.error, success: context.success });
        }),
    });

    const program = Effect.gen(function* () {
      const middleware = yield* RequestTimingMiddleware;
      return yield* middleware({ next: Effect.die("boom"), props: { id: 1 } });
    }).pipe(Effect.provide(layer));

    const exit = await Effect.runPromiseExit(program);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(finishCalls).toHaveLength(1);
    expect(finishCalls[0]?.success).toBe(false);
    expect(finishCalls[0]?.error).toBeDefined();
  });

  it("skips hooks when sampleRate is zero", async () => {
    const onStart = vi.fn(() => Effect.void);
    const onFinish = vi.fn(() => Effect.void);

    const layer = makeRequestTimingMiddleware({
      onFinish,
      onStart,
      sampleRate: 0,
    });

    const program = Effect.gen(function* () {
      const middleware = yield* RequestTimingMiddleware;
      return yield* middleware({ next: Effect.succeed("ok"), props: { id: 1 } });
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result).toBe("ok");
    expect(onStart).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("uses injectable random sampling", async () => {
    const onStart = vi.fn(() => Effect.void);
    const onFinish = vi.fn(() => Effect.void);

    const layer = makeRequestTimingMiddleware({
      onFinish,
      onStart,
      sampleRate: 0.5,
      random: () => 0.75,
    });

    const program = Effect.gen(function* () {
      const middleware = yield* RequestTimingMiddleware;
      return yield* middleware({ next: Effect.succeed("ok"), props: { id: 1 } });
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result).toBe("ok");
    expect(onStart).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("treats non-finite sample rates as the default", async () => {
    const onStart = vi.fn(() => Effect.void);
    const onFinish = vi.fn(() => Effect.void);

    const layer = makeRequestTimingMiddleware({
      onFinish,
      onStart,
      sampleRate: Number.NaN,
      random: () => 0.99,
    });

    const program = Effect.gen(function* () {
      const middleware = yield* RequestTimingMiddleware;
      return yield* middleware({ next: Effect.succeed("ok"), props: { id: 1 } });
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result).toBe("ok");
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("skips hooks when shouldRecord returns false", async () => {
    const onStart = vi.fn(() => Effect.void);
    const onFinish = vi.fn(() => Effect.void);

    const layer = makeRequestTimingMiddleware({
      onFinish,
      onStart,
      shouldRecord: () => Effect.succeed(false),
    });

    const program = Effect.gen(function* () {
      const middleware = yield* RequestTimingMiddleware;
      return yield* middleware({ next: Effect.succeed("ok"), props: { id: 1 } });
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result).toBe("ok");
    expect(onStart).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("redacts props before recording", async () => {
    const startCalls: Array<{ props: unknown }> = [];
    const finishCalls: Array<{ props: unknown }> = [];

    const layer = makeRequestTimingMiddleware({
      onFinish: (context) =>
        Effect.sync(() => {
          finishCalls.push({ props: context.props });
        }),
      onStart: (context) =>
        Effect.sync(() => {
          startCalls.push({ props: context.props });
        }),
      redactProps: () => ({ id: "redacted" }),
    });

    const program = Effect.gen(function* () {
      const middleware = yield* RequestTimingMiddleware;
      return yield* middleware({ next: Effect.succeed("ok"), props: { id: 1, token: "secret" } });
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result).toBe("ok");
    expect(startCalls[0]?.props).toEqual({ id: "redacted" });
    expect(finishCalls[0]?.props).toEqual({ id: "redacted" });
  });
});
