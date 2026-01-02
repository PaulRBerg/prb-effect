import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { RequestDedup, RequestDedupLive } from "@/src/rpc/index.js";

describe("RequestDedup", () => {
  it.effect("single call executes effect once", () =>
    Effect.gen(function* () {
      const dedup = yield* RequestDedup;
      let executions = 0;

      const result = yield* dedup.dedupe(
        "test-key",
        Effect.sync(() => {
          executions += 1;
          return "value";
        })
      );

      expect(result).toBe("value");
      expect(executions).toBe(1);
    }).pipe(Effect.provide(RequestDedupLive))
  );

  it.effect("concurrent calls with same key execute effect once", () =>
    Effect.gen(function* () {
      const dedup = yield* RequestDedup;
      let executions = 0;
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();

      const effect = Effect.gen(function* () {
        executions += 1;
        // Signal that the shared underlying effect has started executing.
        // This makes the test deterministic: we only open the gate once at least
        // one fiber is definitely inside the effect.
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(gate);
        return "shared-result";
      });

      // Start three concurrent calls with the same key
      const fiber1 = yield* Effect.fork(dedup.dedupe("concurrent-key", effect));
      const fiber2 = yield* Effect.fork(dedup.dedupe("concurrent-key", effect));
      const fiber3 = yield* Effect.fork(dedup.dedupe("concurrent-key", effect));

      // Ensure at least one fiber has started the underlying effect before opening the gate
      yield* Deferred.await(started);
      yield* Deferred.succeed(gate, undefined);

      // Wait for all fibers
      const result1 = yield* Fiber.join(fiber1);
      const result2 = yield* Fiber.join(fiber2);
      const result3 = yield* Fiber.join(fiber3);

      expect(result1).toBe("shared-result");
      expect(result2).toBe("shared-result");
      expect(result3).toBe("shared-result");
      expect(executions).toBe(1);
    }).pipe(Effect.provide(RequestDedupLive))
  );

  it.effect("success propagates to all waiting callers", () =>
    Effect.gen(function* () {
      const dedup = yield* RequestDedup;
      const deferred = yield* Deferred.make<void>();

      const effect = Effect.gen(function* () {
        yield* Deferred.await(deferred);
        return { data: 42, status: "success" };
      });

      const fiber1 = yield* Effect.fork(dedup.dedupe("success-key", effect));
      const fiber2 = yield* Effect.fork(dedup.dedupe("success-key", effect));

      yield* Deferred.succeed(deferred, undefined);

      const result1 = yield* Fiber.join(fiber1);
      const result2 = yield* Fiber.join(fiber2);

      expect(result1).toEqual({ data: 42, status: "success" });
      expect(result2).toEqual({ data: 42, status: "success" });
    }).pipe(Effect.provide(RequestDedupLive))
  );

  it.effect("error propagates to all waiting callers", () =>
    Effect.gen(function* () {
      const dedup = yield* RequestDedup;
      const deferred = yield* Deferred.make<void>();

      const effect = Effect.gen(function* () {
        yield* Deferred.await(deferred);
        return yield* Effect.fail(new Error("shared-error"));
      });

      const fiber1 = yield* Effect.fork(dedup.dedupe("error-key", effect));
      const fiber2 = yield* Effect.fork(dedup.dedupe("error-key", effect));

      yield* Deferred.succeed(deferred, undefined);

      const exit1 = yield* Fiber.join(fiber1).pipe(Effect.exit);
      const exit2 = yield* Fiber.join(fiber2).pipe(Effect.exit);

      expect(exit1._tag).toBe("Failure");
      expect(exit2._tag).toBe("Failure");

      if (exit1._tag === "Failure" && exit2._tag === "Failure") {
        const cause1 = exit1.cause;
        const cause2 = exit2.cause;
        // Both should have the same error
        expect(cause1).toBeDefined();
        expect(cause2).toBeDefined();
      }
    }).pipe(Effect.provide(RequestDedupLive))
  );

  it.effect("different keys execute independently", () =>
    Effect.gen(function* () {
      const dedup = yield* RequestDedup;
      let executionsA = 0;
      let executionsB = 0;

      const effectA = Effect.sync(() => {
        executionsA += 1;
        return "result-A";
      });

      const effectB = Effect.sync(() => {
        executionsB += 1;
        return "result-B";
      });

      const resultA = yield* dedup.dedupe("key-A", effectA);
      const resultB = yield* dedup.dedupe("key-B", effectB);

      expect(resultA).toBe("result-A");
      expect(resultB).toBe("result-B");
      expect(executionsA).toBe(1);
      expect(executionsB).toBe(1);
    }).pipe(Effect.provide(RequestDedupLive))
  );

  it.effect("key cleaned up after completion", () =>
    Effect.gen(function* () {
      const dedup = yield* RequestDedup;
      let executions = 0;

      const effect = Effect.sync(() => {
        executions += 1;
        return "value";
      });

      // First call
      const result1 = yield* dedup.dedupe("cleanup-key", effect);
      expect(result1).toBe("value");
      expect(executions).toBe(1);

      // Second call after completion should execute fresh
      const result2 = yield* dedup.dedupe("cleanup-key", effect);
      expect(result2).toBe("value");
      expect(executions).toBe(2);
    }).pipe(Effect.provide(RequestDedupLive))
  );

  it.effect("effect failure doesn't prevent cleanup", () =>
    Effect.gen(function* () {
      const dedup = yield* RequestDedup;
      let executions = 0;

      const effect = Effect.gen(function* () {
        executions += 1;
        return yield* Effect.fail(new Error("test-error"));
      });

      // First call fails
      const exit1 = yield* dedup.dedupe("failure-key", effect).pipe(Effect.exit);
      expect(exit1._tag).toBe("Failure");
      expect(executions).toBe(1);

      // Second call after failure should execute fresh
      const exit2 = yield* dedup.dedupe("failure-key", effect).pipe(Effect.exit);
      expect(exit2._tag).toBe("Failure");
      expect(executions).toBe(2);
    }).pipe(Effect.provide(RequestDedupLive))
  );

  it.effect("multiple sequential calls with same key each execute", () =>
    Effect.gen(function* () {
      const dedup = yield* RequestDedup;
      let executions = 0;

      const effect = Effect.sync(() => {
        executions += 1;
        return `value-${executions}`;
      });

      const result1 = yield* dedup.dedupe("sequential-key", effect);
      const result2 = yield* dedup.dedupe("sequential-key", effect);
      const result3 = yield* dedup.dedupe("sequential-key", effect);

      expect(result1).toBe("value-1");
      expect(result2).toBe("value-2");
      expect(result3).toBe("value-3");
      expect(executions).toBe(3);
    }).pipe(Effect.provide(RequestDedupLive))
  );

  it.effect("concurrent calls with different data types", () =>
    Effect.gen(function* () {
      const dedup = yield* RequestDedup;
      const deferred = yield* Deferred.make<void>();

      const numberEffect = Effect.gen(function* () {
        yield* Deferred.await(deferred);
        return 42;
      });

      const stringEffect = Effect.gen(function* () {
        yield* Deferred.await(deferred);
        return "text";
      });

      const fiber1 = yield* Effect.fork(dedup.dedupe("num-key", numberEffect));
      const fiber2 = yield* Effect.fork(dedup.dedupe("str-key", stringEffect));

      yield* Deferred.succeed(deferred, undefined);

      const result1 = yield* Fiber.join(fiber1);
      const result2 = yield* Fiber.join(fiber2);

      expect(result1).toBe(42);
      expect(result2).toBe("text");
    }).pipe(Effect.provide(RequestDedupLive))
  );

  it.effect("many concurrent calls with same key", () =>
    Effect.gen(function* () {
      const dedup = yield* RequestDedup;
      let executions = 0;
      const deferred = yield* Deferred.make<void>();

      const effect = Effect.gen(function* () {
        executions += 1;
        yield* Deferred.await(deferred);
        return "shared";
      });

      // Start 10 concurrent calls
      const fibers = yield* Effect.forEach(
        Array.from({ length: 10 }, (_, i) => i),
        () => Effect.fork(dedup.dedupe("many-key", effect)),
        { concurrency: "unbounded" }
      );

      yield* Deferred.succeed(deferred, undefined);

      const results = yield* Effect.forEach(fibers, (fiber) => Fiber.join(fiber));

      expect(results).toHaveLength(10);
      expect(results.every((r) => r === "shared")).toBe(true);
      expect(executions).toBe(1);
    }).pipe(Effect.provide(RequestDedupLive))
  );
});
