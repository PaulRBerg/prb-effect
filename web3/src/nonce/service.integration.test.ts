import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber } from "effect";
import type { Address } from "viem";
import { mainnet } from "viem/chains";
import { ClientNotFoundError } from "@/src/core/index.js";
import { NonceService } from "@/src/nonce/index.js";
import { makeEffectWeb3TestLayer } from "@/src/testing-kit/index.js";

describe("NonceService (Live)", () => {
  const testAddress = "0x1234567890123456789012345678901234567890" as Address;

  const testLayer = makeEffectWeb3TestLayer({
    publicClient: {
      getTransactionCount: async () => 0,
    },
  });

  describe("getNext", () => {
    it.effect("returns on-chain pending count by default", () =>
      Effect.gen(function* () {
        const service = yield* NonceService;
        const nonce = yield* service.getNext({
          address: testAddress,
          chainId: mainnet.id,
        });

        expect(nonce).toBe(0n);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("fails for unsupported chainId", () =>
      Effect.gen(function* () {
        const service = yield* NonceService;
        const exit = yield* Effect.exit(service.getNext({ address: testAddress, chainId: 999 }));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(ClientNotFoundError);
          }
        }
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("reserve", () => {
    it.effect("reserves sequential nonces", () =>
      Effect.gen(function* () {
        const service = yield* NonceService;
        const nonce0 = yield* service.reserve({
          address: testAddress,
          chainId: mainnet.id,
        });
        const nonce1 = yield* service.reserve({
          address: testAddress,
          chainId: mainnet.id,
        });

        expect(nonce0).toBe(0n);
        expect(nonce1).toBe(1n);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("is atomic under concurrency (no duplicates)", () =>
      Effect.gen(function* () {
        let started = 0;
        let resolveReady: (() => void) | undefined;
        let resolveGo: (() => void) | undefined;

        const ready = new Promise<void>((r) => {
          resolveReady = r;
        });
        const go = new Promise<void>((r) => {
          resolveGo = r;
        });

        const concurrency = 100;
        const layer = makeEffectWeb3TestLayer({
          publicClient: {
            getTransactionCount: async () => {
              started += 1;
              if (started === concurrency) {
                resolveReady?.();
              }
              await go;
              return 0;
            },
          },
        });

        const fibers = yield* Effect.gen(function* () {
          const service = yield* NonceService;
          return yield* Effect.forEach(
            Array.from({ length: concurrency }, () => null),
            () =>
              Effect.fork(
                service.reserve({
                  address: testAddress,
                  chainId: mainnet.id,
                })
              ),
            { concurrency: "unbounded" }
          );
        }).pipe(Effect.provide(layer));

        yield* Effect.promise(() => ready);
        resolveGo?.();

        const results = yield* Effect.forEach(fibers, (fiber) => Fiber.join(fiber), {
          concurrency: "unbounded",
        });

        const uniq = new Set(results.map(String));
        expect(uniq.size).toBe(concurrency);
      })
    );
  });

  describe("release + gaps", () => {
    it.effect("tracks gaps for reserved but missing nonces", () =>
      Effect.gen(function* () {
        const service = yield* NonceService;
        const nonce0 = yield* service.reserve({
          address: testAddress,
          chainId: mainnet.id,
        });
        const nonce1 = yield* service.reserve({
          address: testAddress,
          chainId: mainnet.id,
        });
        const nonce2 = yield* service.reserve({
          address: testAddress,
          chainId: mainnet.id,
        });

        expect([nonce0, nonce1, nonce2]).toEqual([0n, 1n, 2n]);

        yield* service.release({
          address: testAddress,
          chainId: mainnet.id,
          nonce: 1n,
        });

        const gaps = yield* service.getGaps({
          address: testAddress,
          chainId: mainnet.id,
        });
        expect(gaps).toEqual([1n]);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("sync", () => {
    it.effect("syncs confirmed count and influences getNext", () => {
      let count = 0;
      const layer = makeEffectWeb3TestLayer({
        publicClient: {
          getTransactionCount: async (params) => (params.blockTag === "latest" ? 5 : count),
        },
      });

      return Effect.gen(function* () {
        const service = yield* NonceService;

        const confirmed = yield* service.sync({
          address: testAddress,
          chainId: mainnet.id,
        });
        expect(confirmed).toBe(5n);

        // Pending below confirmed should return confirmed (cachedConfirmed wins).
        count = 2;
        const next = yield* service.getNext({
          address: testAddress,
          chainId: mainnet.id,
        });
        expect(next).toBe(5n);
      }).pipe(Effect.provide(layer));
    });
  });
});
