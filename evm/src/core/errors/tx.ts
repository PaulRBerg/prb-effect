import { Cause, Effect, Schema } from "effect";
import { dual } from "effect/Function";

import { isTaggedError } from "./predicates.js";

export type TxReplacementReason = "cancelled" | "replaced" | "repriced";

export class UserRejectedError extends Schema.TaggedError<UserRejectedError>()(
  "UserRejectedError",
  {
    message: Schema.String,
  }
) {}

export class TxFailedError extends Schema.TaggedError<TxFailedError>()("TxFailedError", {
  cause: Schema.optional(Schema.Unknown),
  hash: Schema.String,
  message: Schema.String,
}) {}

export class TxReplacedError extends Schema.TaggedError<TxReplacedError>()("TxReplacedError", {
  message: Schema.String,
  newHash: Schema.String,
  oldHash: Schema.String,
  reason: Schema.Literal("cancelled", "replaced", "repriced"),
}) {}

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
    available: Schema.optional(Schema.String),
    message: Schema.String,
    required: Schema.optional(Schema.String),
  }
) {}

export type TransactionSubmissionReason = "raw-transaction-decoding";

/**
 * Wallet/RPC submission failed before a transaction hash was returned.
 */
export class TransactionSubmissionError extends Schema.TaggedError<TransactionSubmissionError>()(
  "TransactionSubmissionError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
    reason: Schema.Literal("raw-transaction-decoding"),
  }
) {}

/**
 * Device or environment ran out of resources during an RPC call.
 *
 * Common causes:
 * - iOS WKWebView memory limits (Safari's ~256 MB cap for web content processes)
 * - Mobile browser memory pressure under constrained conditions
 *
 * This error is non-retryable: the transaction was never submitted to the network.
 */
export class ResourceExhaustionError extends Schema.TaggedError<ResourceExhaustionError>()(
  "ResourceExhaustionError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
  }
) {}

/**
 * Strict _tag guard for UserRejectedError.
 */
export const isTaggedUserRejectedError = isTaggedError<UserRejectedError>("UserRejectedError");

const USER_REJECTION_CODE = 4001;
const USER_REJECTION_MESSAGE_FRAGMENTS = [
  "user rejected",
  "user denied",
  "user cancelled",
  "rejected by user",
  "denied by user",
  "rejected the request",
  "transaction was rejected", // Safe SDK rejection
];

type UserRejectionRecord = {
  readonly _tag?: unknown;
  readonly cause?: unknown;
  readonly code?: unknown;
  readonly error?: unknown;
  readonly errors?: unknown;
  readonly name?: unknown;
};

type UserRejectionLooseRecord = UserRejectionRecord & {
  readonly message?: unknown;
};

function matchesUserRejectionMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return USER_REJECTION_MESSAGE_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function matchesUserRejectionTag(tag: string): boolean {
  return tag.trim().toLowerCase().includes("userrejected");
}

function matchesUserRejectionName(name: string): boolean {
  return name.trim().toLowerCase().includes("userrejected");
}

function isUserRejectionCode(value: unknown): boolean {
  return value === USER_REJECTION_CODE || value === `${USER_REJECTION_CODE}`;
}

function checkUserRejectionRecord(record: UserRejectionRecord, depth: number): boolean {
  if (typeof record._tag === "string" && matchesUserRejectionTag(record._tag)) {
    return true;
  }

  if (typeof record.name === "string" && matchesUserRejectionName(record.name)) {
    return true;
  }

  if (isUserRejectionCode(record.code)) {
    return true;
  }

  if (Cause.isCause(record.cause)) {
    return checkUserRejection(Cause.squash(record.cause), depth + 1);
  }

  if (record.cause && checkUserRejection(record.cause, depth + 1)) {
    return true;
  }

  if (record.error && checkUserRejection(record.error, depth + 1)) {
    return true;
  }

  if (Array.isArray(record.errors)) {
    return record.errors.some((error) => checkUserRejection(error, depth + 1));
  }

  return false;
}

function checkUserRejection(error: unknown, depth: number): boolean {
  if (!error || depth > 4) {
    return false;
  }

  if (isTaggedUserRejectedError(error)) {
    return true;
  }

  if (Cause.isCause(error)) {
    return checkUserRejection(Cause.squash(error), depth + 1);
  }

  if (error instanceof Error) {
    if (matchesUserRejectionName(error.name)) {
      return true;
    }
    if (isUserRejectionCode((error as { code?: unknown }).code)) {
      return true;
    }
    const tag = (error as { _tag?: unknown })._tag;
    if (typeof tag === "string" && matchesUserRejectionTag(tag)) {
      return true;
    }
    return checkUserRejectionRecord(error as UserRejectionRecord, depth);
  }

  if (typeof error === "object") {
    return checkUserRejectionRecord(error as UserRejectionRecord, depth);
  }

  return false;
}

/**
 * Strict user rejection detection based on tags, names, codes, and nested causes.
 */
export function isUserRejectedError(error: unknown): boolean {
  return checkUserRejection(error, 0);
}

/**
 * Lenient user rejection check based on error messages and nested causes.
 * Useful for UI hints, not for control flow.
 */
export function isLikelyUserRejectedError(error: unknown): boolean {
  return checkLikelyUserRejection(error, 0);
}

function checkLikelyUserRejectionRecord(record: UserRejectionLooseRecord, depth: number): boolean {
  if (typeof record.message === "string" && matchesUserRejectionMessage(record.message)) {
    return true;
  }
  if (Cause.isCause(record.cause)) {
    return checkLikelyUserRejection(Cause.squash(record.cause), depth + 1);
  }
  if (record.cause && checkLikelyUserRejection(record.cause, depth + 1)) {
    return true;
  }
  if (record.error && checkLikelyUserRejection(record.error, depth + 1)) {
    return true;
  }
  if (Array.isArray(record.errors)) {
    return record.errors.some((err) => checkLikelyUserRejection(err, depth + 1));
  }
  return false;
}

function checkLikelyUserRejection(error: unknown, depth: number): boolean {
  if (!error || depth > 4) {
    return false;
  }

  if (isUserRejectedError(error)) {
    return true;
  }

  if (typeof error === "string") {
    return matchesUserRejectionMessage(error);
  }

  if (Cause.isCause(error)) {
    return checkLikelyUserRejection(Cause.squash(error), depth + 1);
  }

  if (error instanceof Error) {
    if (matchesUserRejectionMessage(error.message)) {
      return true;
    }
    return checkLikelyUserRejectionRecord(error as UserRejectionLooseRecord, depth);
  }

  if (typeof error === "object") {
    return checkLikelyUserRejectionRecord(error as UserRejectionLooseRecord, depth);
  }

  return false;
}

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
