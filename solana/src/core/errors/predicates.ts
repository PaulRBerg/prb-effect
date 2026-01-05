import { Effect } from "effect";
import { dual } from "effect/Function";

import type { UserRejectedError } from "./wallet.js";

/** Shape of Effect-TS tagged errors */
export type TaggedErrorShape = {
  readonly _tag: string;
  readonly message: string;
  readonly cause?: unknown;
};

/**
 * Check if an error has the shape of a tagged error (has _tag property).
 * Use this for general tagged error detection without checking a specific tag.
 */
export const hasTaggedErrorShape = (error: unknown): error is TaggedErrorShape =>
  error !== null && typeof error === "object" && "_tag" in error && typeof error._tag === "string";

/**
 * Creates a type guard for tagged errors with a specific tag.
 * Works with both instanceof checks and _tag property (for serialized errors).
 */
export const isTaggedError =
  <T extends { readonly _tag: string }>(tag: T["_tag"]) =>
  (error: unknown): error is T =>
    hasTaggedErrorShape(error) && error._tag === tag;

/**
 * Type guard for UserRejectedError.
 * Works with both instanceof and _tag (for serialized errors).
 */
export const isTaggedUserRejectedError = isTaggedError<UserRejectedError>("UserRejectedError");

/**
 * Type guard for UserRejectedError.
 * Works with both instanceof and _tag (for serialized errors).
 */
export const isUserRejectedError = isTaggedUserRejectedError;

/**
 * Catch UserRejectedError and return a fallback value.
 * Useful for treating rejection as "cancelled" rather than "failed".
 *
 * @example
 * ```ts
 * const result = await Effect.runPromise(
 *   sendTransaction(tx).pipe(catchUserRejection(null))
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
 *   sendTransaction(tx).pipe(
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
