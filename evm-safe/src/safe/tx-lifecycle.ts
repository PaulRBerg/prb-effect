/**
 * Safe multisig transaction lifecycle tracking.
 *
 * Polls the Safe API to track transactions from proposal through execution.
 * Fills the gap between sendTxs() (which returns a safeTxHash) and knowing
 * when the transaction lands on-chain.
 *
 * @module safe/tx-lifecycle
 */

import { Duration, Effect, Option } from "effect";
import type { Hash, TransactionReceipt } from "viem";
import type { SafeMultisigTxLookupError } from "./errors.js";
import { SafeAppsService } from "./service.js";

// ---------------------------------------------------------------------------
// Configuration defaults
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL = Duration.seconds(5);
const DEFAULT_MAX_WAIT = Duration.minutes(90);
const MIN_POLL_INTERVAL = Duration.seconds(1);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SafeMultisigWaitOptions = {
  /** Polling interval (default: 5 seconds). Clamped to a minimum of 1 second. */
  readonly interval?: Duration.DurationInput;
  /** Maximum wait time (default: 90 minutes) */
  readonly maxWait?: Duration.DurationInput;
};

export type SafeMultisigWaitResult =
  | { readonly _tag: "success"; readonly hash: Hash; readonly receipt: TransactionReceipt }
  | { readonly _tag: "queued"; readonly safeTxHash: Hash }
  | { readonly _tag: "cancelled" }
  | { readonly _tag: "failed"; readonly error: string };

export type SafeMultisigTxStatus =
  | "awaiting_confirmations"
  | "awaiting_execution"
  | "pending"
  | "success"
  | "failed";

// ---------------------------------------------------------------------------
// waitForSafeMultisigTx
// ---------------------------------------------------------------------------

/**
 * Poll a Safe multisig transaction until it reaches a terminal state or times out.
 *
 * Unlike `SafeAppsService.waitForTxReceipt` (which assumes execution will happen
 * in the current session), this utility handles the full lifecycle including
 * transactions that stay queued because other signers haven't signed yet.
 *
 * Terminal states: success (on-chain), cancelled, failed.
 * On timeout the safeTxHash is returned as "queued" so callers can persist it
 * for later resolution.
 *
 * @param safeTxHash  - The Safe transaction hash returned by `sendTxs`
 * @param getReceipt  - Caller-provided effect to fetch an on-chain receipt
 * @param options     - Optional polling configuration
 */
export const waitForSafeMultisigTx = Effect.fn("waitForSafeMultisigTx")(function* (
  safeTxHash: Hash,
  getReceipt: (hash: Hash) => Effect.Effect<TransactionReceipt, SafeMultisigTxLookupError>,
  options: SafeMultisigWaitOptions = {}
) {
  const interval = Duration.max(
    Duration.decode(options.interval ?? DEFAULT_POLL_INTERVAL),
    MIN_POLL_INTERVAL
  );
  const maxWait = Duration.decode(options.maxWait ?? DEFAULT_MAX_WAIT);
  const maxAttempts = Math.floor(Duration.toMillis(maxWait) / Duration.toMillis(interval));

  const safeApps = yield* SafeAppsService;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // --- Fetch tx status, classifying errors ---
    const queuedResult = yield* safeApps.getTx(safeTxHash).pipe(
      Effect.map(Option.some),
      Effect.catchTag("SafeMultisigTxLookupError", (error) => {
        if (error.retryable) {
          return Effect.logWarning("Retryable error polling Safe tx").pipe(
            Effect.annotateLogs({ attempt, error: error.message, safeTxHash }),
            Effect.as(Option.none<{ txHash: Option.Option<Hash>; status: string }>())
          );
        }
        // Terminal lookup error — stop polling immediately
        return Effect.fail(error);
      })
    );

    if (Option.isNone(queuedResult)) {
      yield* Effect.sleep(interval);
      continue;
    }

    const queued = queuedResult.value;
    yield* Effect.logDebug("Safe tx poll status").pipe(
      Effect.annotateLogs({
        attempt,
        hash: Option.isSome(queued.txHash) ? queued.txHash.value : "pending",
        safeTxHash,
        status: queued.status,
      })
    );

    // --- Terminal states ---

    if (queued.status === "CANCELLED") {
      return { _tag: "cancelled" as const } satisfies SafeMultisigWaitResult;
    }

    if (queued.status === "FAILED") {
      return {
        _tag: "failed" as const,
        error: "Safe transaction failed",
      } satisfies SafeMultisigWaitResult;
    }

    if (queued.status === "SUCCESS") {
      if (Option.isNone(queued.txHash)) {
        return {
          _tag: "failed" as const,
          error: "Safe transaction succeeded but no on-chain hash available",
        } satisfies SafeMultisigWaitResult;
      }
      const txHash = queued.txHash.value as Hash;
      const receipt = yield* getReceipt(txHash);
      return {
        _tag: "success" as const,
        hash: txHash,
        receipt,
      } satisfies SafeMultisigWaitResult;
    }

    // Still pending — keep polling
    yield* Effect.sleep(interval);
  }

  // Timed out without reaching a terminal state
  yield* Effect.logWarning("Safe multisig transaction polling timeout").pipe(
    Effect.annotateLogs({
      maxAttempts,
      maxWaitMs: Duration.toMillis(maxWait),
      safeTxHash,
    })
  );

  return { _tag: "queued" as const, safeTxHash } satisfies SafeMultisigWaitResult;
});

// ---------------------------------------------------------------------------
// getSafeMultisigTxStatus
// ---------------------------------------------------------------------------

/**
 * Fetch the current lifecycle status of a Safe multisig transaction.
 *
 * Maps the raw Safe API status string to a normalized union. Useful for
 * one-shot status checks (e.g. resuming after page reload) without starting
 * a polling loop.
 */
export const getSafeMultisigTxStatus = Effect.fn("getSafeMultisigTxStatus")(function* (
  safeTxHash: Hash
) {
  const safeApps = yield* SafeAppsService;
  const queued = yield* safeApps.getTx(safeTxHash);

  switch (queued.status) {
    case "AWAITING_CONFIRMATIONS":
      return "awaiting_confirmations";
    case "AWAITING_EXECUTION":
      return "awaiting_execution";
    case "SUCCESS":
      return "success";
    // Both map to "failed" — use waitForSafeMultisigTx to distinguish cancelled vs failed
    case "CANCELLED":
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
});
