import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Schema, TestClock } from "effect";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  CacheReadError,
  CacheWriteError,
  cachedEffect,
  cachedEffectWithKey,
  makeInMemoryPersistentCacheStore,
} = await import("./index.js");

describe("persistent cache", () => {
  it.effect("returns cache hits without rerunning the refresh effect", () =>
    Effect.gen(function* () {
      const store = makeInMemoryPersistentCacheStore();
      let calls = 0;
      const cached = cachedEffect(
        Effect.sync(() => {
          calls += 1;
          return `value-${calls}`;
        }),
        { key: "hit", store, ttl: "1 minute" }
      );

      const first = yield* cached;
      const second = yield* cached;

      expect(first).toBe("value-1");
      expect(second).toBe("value-1");
      expect(calls).toBe(1);
    })
  );

  it.effect("refreshes after TTL expiry", () =>
    Effect.gen(function* () {
      const store = makeInMemoryPersistentCacheStore();
      let calls = 0;
      const cached = cachedEffect(
        Effect.sync(() => {
          calls += 1;
          return `value-${calls}`;
        }),
        { key: "ttl", store, ttl: "50 millis" }
      );

      const first = yield* cached;
      yield* TestClock.adjust("60 millis");
      const second = yield* cached;

      expect(first).toBe("value-1");
      expect(second).toBe("value-2");
      expect(calls).toBe(2);
    })
  );

  it.effect("returns stale data while one background refresh runs", () =>
    Effect.gen(function* () {
      const store = makeInMemoryPersistentCacheStore();
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      let calls = 0;
      const cached = cachedEffect(
        Effect.gen(function* () {
          calls += 1;
          if (calls > 1) {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(gate);
          }
          return `value-${calls}`;
        }),
        {
          key: "swr",
          staleWhileRevalidate: "1 minute",
          store,
          ttl: "50 millis",
        }
      );

      const first = yield* cached;
      yield* TestClock.adjust("60 millis");

      const fiber1 = yield* Effect.fork(cached);
      const fiber2 = yield* Effect.fork(cached);

      yield* Deferred.await(started);
      const stale1 = yield* Fiber.join(fiber1);
      const stale2 = yield* Fiber.join(fiber2);

      expect(first).toBe("value-1");
      expect(stale1).toBe("value-1");
      expect(stale2).toBe("value-1");
      expect(calls).toBe(2);

      yield* Deferred.succeed(gate, undefined);
      yield* TestClock.adjust("1 millis");
      const refreshed = yield* cached;

      expect(refreshed).toBe("value-2");
      expect(calls).toBe(2);
    })
  );

  it.effect("coalesces concurrent misses", () =>
    Effect.gen(function* () {
      const store = makeInMemoryPersistentCacheStore();
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      let calls = 0;
      const cached = cachedEffect(
        Effect.gen(function* () {
          calls += 1;
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(gate);
          return "shared";
        }),
        { key: "miss", store, ttl: "1 minute" }
      );

      const fiber1 = yield* Effect.fork(cached);
      const fiber2 = yield* Effect.fork(cached);
      const fiber3 = yield* Effect.fork(cached);

      yield* Deferred.await(started);
      expect(calls).toBe(1);
      yield* Deferred.succeed(gate, undefined);

      const result1 = yield* Fiber.join(fiber1);
      const result2 = yield* Fiber.join(fiber2);
      const result3 = yield* Fiber.join(fiber3);

      expect(result1).toBe("shared");
      expect(result2).toBe("shared");
      expect(result3).toBe("shared");
      expect(calls).toBe(1);
    })
  );

  it.effect("decodes cached values and replaces invalid entries", () =>
    Effect.gen(function* () {
      const store = makeInMemoryPersistentCacheStore();
      const schema = Schema.Struct({ value: Schema.String });

      yield* store.set("decode", {
        cachedAt: 0,
        expiresAt: 60_000,
        staleUntil: null,
        value: { value: 123 },
      });

      const result = yield* cachedEffect(Effect.succeed({ value: "fresh" }), {
        key: "decode",
        schema,
        store,
        ttl: "1 minute",
      });
      const cached = yield* store.get("decode");

      expect(result).toEqual({ value: "fresh" });
      expect(cached?.value).toEqual({ value: "fresh" });
    })
  );

  it.effect("refreshes expired invalid entries instead of decoding them", () =>
    Effect.gen(function* () {
      const store = makeInMemoryPersistentCacheStore();
      const schema = Schema.Struct({ value: Schema.String });

      yield* store.set("expired-decode", {
        cachedAt: 0,
        expiresAt: 1,
        staleUntil: null,
        value: { value: 123 },
      });
      yield* TestClock.adjust("2 millis");

      const result = yield* cachedEffect(Effect.succeed({ value: "fresh" }), {
        failurePolicy: "fail-closed",
        key: "expired-decode",
        schema,
        store,
        ttl: "1 minute",
      });

      expect(result).toEqual({ value: "fresh" });
    })
  );

  it.effect("supports derived keys", () =>
    Effect.gen(function* () {
      const store = makeInMemoryPersistentCacheStore();
      let calls = 0;
      const cached = cachedEffectWithKey(
        (id: string) =>
          Effect.sync(() => {
            calls += 1;
            return `user-${id}-${calls}`;
          }),
        (id) => `user:${id}`,
        { store, ttl: "1 minute" }
      );

      const first = yield* cached("1");
      const second = yield* cached("1");
      const third = yield* cached("2");

      expect(first).toBe("user-1-1");
      expect(second).toBe("user-1-1");
      expect(third).toBe("user-2-2");
      expect(calls).toBe(2);
    })
  );

  it.effect("fails open on store read and write errors by default", () =>
    Effect.gen(function* () {
      const readFailingStore = {
        delete: () => Effect.void,
        get: () => Effect.fail("read-down"),
        set: () => Effect.void,
      };
      const writeFailingStore = {
        delete: () => Effect.void,
        get: () => Effect.succeed(null),
        set: () => Effect.fail("write-down"),
      };

      const readResult = yield* cachedEffect(Effect.succeed("read-open"), {
        key: "read",
        store: readFailingStore,
        ttl: "1 minute",
      });
      const writeResult = yield* cachedEffect(Effect.succeed("write-open"), {
        key: "write",
        store: writeFailingStore,
        ttl: "1 minute",
      });

      expect(readResult).toBe("read-open");
      expect(writeResult).toBe("write-open");
    })
  );

  it.effect("fails closed on store read and write errors when requested", () =>
    Effect.gen(function* () {
      const readFailingStore = {
        delete: () => Effect.void,
        get: () => Effect.fail("read-down"),
        set: () => Effect.void,
      };
      const writeFailingStore = {
        delete: () => Effect.void,
        get: () => Effect.succeed(null),
        set: () => Effect.fail("write-down"),
      };

      const readExit = yield* cachedEffect(Effect.succeed("read-closed"), {
        failurePolicy: "fail-closed",
        key: "read",
        store: readFailingStore,
        ttl: "1 minute",
      }).pipe(Effect.either);
      const writeExit = yield* cachedEffect(Effect.succeed("write-closed"), {
        failurePolicy: "fail-closed",
        key: "write",
        store: writeFailingStore,
        ttl: "1 minute",
      }).pipe(Effect.either);

      expect(readExit._tag).toBe("Left");
      expect(writeExit._tag).toBe("Left");
      if (readExit._tag === "Left") {
        expect(readExit.left).toBeInstanceOf(CacheReadError);
      }
      if (writeExit._tag === "Left") {
        expect(writeExit.left).toBeInstanceOf(CacheWriteError);
      }
    })
  );
});
