import type { Scope } from "effect";
import { Effect, Ref } from "effect";
import type { Address } from "viem";
import type { ClientNotFoundError, TransportError } from "#src/core/index.js";
import type { NonceServiceShape } from "#src/nonce/index.js";
import { nonceToBigInt } from "./helpers.js";

export type NonceReservationResult = {
  readonly nonce: number | bigint;
  readonly reserved: boolean;
  readonly markSubmitted: Effect.Effect<void>;
};

/**
 * Reserve a nonce with proper cleanup semantics.
 * If explicitNonce is provided, no reservation is made.
 * Otherwise, reserves from NonceService and releases on scope exit if not submitted.
 */
export const withNonceReservation = (
  nonceService: NonceServiceShape,
  params: {
    account: Address;
    chainId: number;
    explicitNonce: number | bigint | undefined;
  }
): Effect.Effect<NonceReservationResult, ClientNotFoundError | TransportError, Scope.Scope> =>
  Effect.gen(function* () {
    const nonceSubmittedRef = yield* Ref.make(false);

    const reservation = yield* Effect.acquireRelease(
      Effect.gen(function* () {
        if (params.explicitNonce !== undefined) {
          return { nonce: params.explicitNonce, reserved: false } as const;
        }

        const reservedNonce = yield* nonceService.reserve({
          address: params.account,
          chainId: params.chainId,
        });

        return { nonce: reservedNonce, reserved: true } as const;
      }),
      ({ nonce, reserved }) =>
        Effect.gen(function* () {
          if (!reserved) {
            return;
          }
          const submitted = yield* Ref.get(nonceSubmittedRef);
          if (submitted) {
            return;
          }

          yield* nonceService.release({
            address: params.account,
            chainId: params.chainId,
            nonce: nonceToBigInt(nonce),
          });
        })
    );

    return {
      markSubmitted: Ref.set(nonceSubmittedRef, true),
      nonce: reservation.nonce,
      reserved: reservation.reserved,
    };
  });

/**
 * Confirm a nonce after successful transaction
 */
export const confirmNonce = (
  nonceService: NonceServiceShape,
  params: {
    account: Address;
    chainId: number;
    nonce: number | bigint;
    reserved: boolean;
  }
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!params.reserved) {
      return;
    }

    yield* nonceService.confirm({
      address: params.account,
      chainId: params.chainId,
      nonce: nonceToBigInt(params.nonce),
    });
  });

/**
 * Advance the local nonce floor after a provider rejects the submitted nonce
 * as already consumed.
 */
export const advanceNonceAfterNonceTooLow = confirmNonce;
