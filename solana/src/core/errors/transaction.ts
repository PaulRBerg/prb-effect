import { Effect, Schema } from "effect";
import { dual } from "effect/Function";

import { hasTaggedErrorShape, isTaggedError } from "./predicates.js";

// =============================================================================
// Error Classes
// =============================================================================

export class UserRejectedError extends Schema.TaggedError<UserRejectedError>()(
  "UserRejectedError",
  {
    message: Schema.String,
  }
) {}

export class TransactionSendError extends Schema.TaggedError<TransactionSendError>()(
  "TransactionSendError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
    signature: Schema.optional(Schema.String),
  }
) {}

export class TransactionFailedError extends Schema.TaggedError<TransactionFailedError>()(
  "TransactionFailedError",
  {
    cause: Schema.optional(Schema.Unknown),
    logs: Schema.optional(Schema.Array(Schema.String)),
    message: Schema.String,
    signature: Schema.String,
  }
) {}

export class TransactionTimeoutError extends Schema.TaggedError<TransactionTimeoutError>()(
  "TransactionTimeoutError",
  {
    message: Schema.String,
    signature: Schema.String,
  }
) {}

export class BlockhashExpiredError extends Schema.TaggedError<BlockhashExpiredError>()(
  "BlockhashExpiredError",
  {
    blockhash: Schema.String,
    message: Schema.String,
  }
) {}

export class SimulationFailedError extends Schema.TaggedError<SimulationFailedError>()(
  "SimulationFailedError",
  {
    cause: Schema.optional(Schema.Unknown),
    logs: Schema.optional(Schema.Array(Schema.String)),
    message: Schema.String,
  }
) {}

// =============================================================================
// User Rejection Detection
// =============================================================================

/**
 * Strict _tag guard for UserRejectedError.
 */
export const isTaggedUserRejectedError = isTaggedError<UserRejectedError>("UserRejectedError");

/**
 * Type guard for UserRejectedError.
 * Works with both instanceof and _tag (for serialized errors).
 */
export const isUserRejectedError = isTaggedUserRejectedError;

/**
 * EIP-1193 / Phantom / Solflare standard error code for user rejection.
 * Both Phantom and Solflare use 4001 following Ethereum's standard.
 */
const USER_REJECTION_CODE = 4001;

/**
 * Fallback message fragments if code is not available.
 */
const USER_REJECTION_MESSAGES = ["user rejected", "rejected the request"];

function isRejectionCode(code: unknown): boolean {
  return code === USER_REJECTION_CODE || code === `${USER_REJECTION_CODE}`;
}

function hasRejectionMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return USER_REJECTION_MESSAGES.some((m) => lower.includes(m));
}

function checkCause(cause: unknown, depth: number): boolean {
  if (!cause || depth > 3) {
    return false;
  }

  // Check for code 4001 (standard rejection code)
  if (typeof cause === "object" && "code" in cause && isRejectionCode(cause.code)) {
    return true;
  }

  // Check message
  if (typeof cause === "string") {
    return hasRejectionMessage(cause);
  }

  if (cause instanceof Error) {
    if (isRejectionCode((cause as { code?: unknown }).code)) {
      return true;
    }
    if (hasRejectionMessage(cause.message)) {
      return true;
    }
    return checkCause((cause as { cause?: unknown }).cause, depth + 1);
  }

  if (typeof cause === "object" && "message" in cause && typeof cause.message === "string") {
    return hasRejectionMessage(cause.message);
  }

  return false;
}

/**
 * Lenient user rejection check for Solana wallet errors.
 *
 * Solana wallets (Phantom, Solflare) use EIP-1193 error code 4001 for user rejection,
 * same as EVM wallets. The error gets wrapped in SignatureError by @prb/effect-solana.
 *
 * Detects:
 * - Tagged UserRejectedError
 * - Tagged WalletNotConnectedError (user didn't connect)
 * - SignatureError with code 4001 or rejection message in cause
 */
export function isLikelyUserRejectedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  // Tagged UserRejectedError
  if (isUserRejectedError(error)) {
    return true;
  }

  // Tagged WalletNotConnectedError - treat as user cancellation
  if (hasTaggedErrorShape(error) && error._tag === "WalletNotConnectedError") {
    return true;
  }

  // SignatureError - check cause for code 4001 or rejection message
  if (hasTaggedErrorShape(error) && error._tag === "SignatureError") {
    return checkCause((error as { cause?: unknown }).cause, 0);
  }

  return false;
}

// =============================================================================
// Effect Operators
// =============================================================================

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
