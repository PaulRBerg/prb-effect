import { Effect, Schema } from "effect";
import { dual } from "effect/Function";

import { isTaggedError } from "./predicates.js";

export type TransactionReplacementReason = "cancelled" | "replaced" | "repriced";

export class UserRejectedError extends Schema.TaggedError<UserRejectedError>()(
  "UserRejectedError",
  {
    message: Schema.String,
  }
) {}

export class TransactionFailedError extends Schema.TaggedError<TransactionFailedError>()(
  "TransactionFailedError",
  {
    cause: Schema.optional(Schema.Unknown),
    hash: Schema.String,
    message: Schema.String,
  }
) {}

export class TransactionReplacedError extends Schema.TaggedError<TransactionReplacedError>()(
  "TransactionReplacedError",
  {
    message: Schema.String,
    newHash: Schema.String,
    oldHash: Schema.String,
    reason: Schema.Literal("cancelled", "replaced", "repriced"),
  }
) {}

export class ReceiptTimeoutError extends Schema.TaggedError<ReceiptTimeoutError>()(
  "ReceiptTimeoutError",
  {
    hash: Schema.String,
    message: Schema.String,
    timeout: Schema.Number,
  }
) {}

export class InsufficientFundsError extends Schema.TaggedError<InsufficientFundsError>()(
  "InsufficientFundsError",
  {
    available: Schema.String,
    message: Schema.String,
    required: Schema.String,
  }
) {}

/**
 * Type guard for UserRejectedError.
 * Works with both instanceof and _tag (for serialized errors).
 */
export const isUserRejectedError = isTaggedError<UserRejectedError>("UserRejectedError");

/**
 * Catch UserRejectedError and return a fallback value.
 * Useful for treating rejection as "cancelled" rather than "failed".
 *
 * @example
 * ```ts
 * const result = await Effect.runPromise(
 *   pipeline.writeAndWait(request).pipe(catchUserRejection(null))
 * );
 * if (result === null) {
 *   // User cancelled - reset to idle
 * }
 * ```
 */
export const catchUserRejection: {
  <A2>(
    fallback: A2
  ): <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A | A2, Exclude<E, UserRejectedError>, R>;
  <A, E, R, A2>(
    effect: Effect.Effect<A, E, R>,
    fallback: A2
  ): Effect.Effect<A | A2, Exclude<E, UserRejectedError>, R>;
} = dual(
  2,
  <A, E, R, A2>(
    effect: Effect.Effect<A, E, R>,
    fallback: A2
  ): Effect.Effect<A | A2, Exclude<E, UserRejectedError>, R> =>
    Effect.catchIf(effect, isUserRejectedError, () => Effect.succeed(fallback)) as Effect.Effect<
      A | A2,
      Exclude<E, UserRejectedError>,
      R
    >
);

/**
 * Catch UserRejectedError and run a fallback effect.
 *
 * @example
 * ```ts
 * const result = await Effect.runPromise(
 *   pipeline.writeAndWait(request).pipe(
 *     catchUserRejectionWith(Effect.succeed({ cancelled: true }))
 *   )
 * );
 * ```
 */
export const catchUserRejectionWith: {
  <A2, E2, R2>(
    fallback: Effect.Effect<A2, E2, R2>
  ): <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A | A2, Exclude<E, UserRejectedError> | E2, R | R2>;
  <A, E, R, A2, E2, R2>(
    effect: Effect.Effect<A, E, R>,
    fallback: Effect.Effect<A2, E2, R2>
  ): Effect.Effect<A | A2, Exclude<E, UserRejectedError> | E2, R | R2>;
} = dual(
  2,
  <A, E, R, A2, E2, R2>(
    effect: Effect.Effect<A, E, R>,
    fallback: Effect.Effect<A2, E2, R2>
  ): Effect.Effect<A | A2, Exclude<E, UserRejectedError> | E2, R | R2> =>
    Effect.catchIf(effect, isUserRejectedError, () => fallback) as Effect.Effect<
      A | A2,
      Exclude<E, UserRejectedError> | E2,
      R | R2
    >
);
