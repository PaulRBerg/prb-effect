import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { TransportError } from "#src/core/index.js";
import { NonceService } from "#src/nonce/index.js";
import {
  assertFailure,
  makeMockNonceServiceLayer,
  TEST_ADDRESS,
  TEST_CHAIN_ID,
} from "#src/testing-kit/index.js";
import { withNonceReservation } from "./nonce.js";

const params = {
  account: TEST_ADDRESS,
  chainId: TEST_CHAIN_ID,
  explicitNonce: undefined,
};

describe("nonce reservation lifetime", () => {
  it.effect("does not install a release for a failed acquisition", () =>
    Effect.gen(function* () {
      let releases = 0;
      const failure = new TransportError({ message: "RPC unavailable", url: "mock" });
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* NonceService;
          return yield* withNonceReservation(service, params);
        })
      ).pipe(
        Effect.result,
        Effect.provide(
          makeMockNonceServiceLayer({
            release: () =>
              Effect.sync(() => {
                releases += 1;
              }),
            reserve: () => Effect.fail(failure),
          })
        )
      );
      expect(assertFailure(result)).toBe(failure);
      expect(releases).toBe(0);
    })
  );

  it.effect("releases an unsubmitted nonce on interruption", () =>
    Effect.gen(function* () {
      const released: bigint[] = [];
      const exit = yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* NonceService;
          yield* withNonceReservation(service, params);
          return yield* Effect.interrupt;
        })
      ).pipe(
        Effect.exit,
        Effect.provide(
          makeMockNonceServiceLayer({
            release: ({ nonce }) =>
              Effect.sync(() => {
                released.push(nonce);
              }),
            reserve: () => Effect.succeed(7n),
          })
        )
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(released).toEqual([7n]);
    })
  );

  it.effect("retains a submitted nonce after its scope closes", () =>
    Effect.gen(function* () {
      let releases = 0;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* NonceService;
          const reservation = yield* withNonceReservation(service, params);
          yield* reservation.markSubmitted;
        })
      ).pipe(
        Effect.provide(
          makeMockNonceServiceLayer({
            release: () =>
              Effect.sync(() => {
                releases += 1;
              }),
          })
        )
      );
      expect(releases).toBe(0);
    })
  );
});
