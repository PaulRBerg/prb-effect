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
import type { SafeMultisigTxInfo } from "./types.js";

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
  /**
   * Invoked on each successful poll (before any terminal resolution) with the latest tx info.
   * Lets callers observe non-terminal lifecycle transitions (confirmation counts,
   * `awaiting_confirmations → awaiting_execution → pending`) that the terminal result alone
   * cannot expose. Failures here MUST NOT abort polling — the loop swallows them.
   */
  readonly onProgress?: (info: SafeMultisigTxInfo) => Effect.Effect<void>;
};

export type SafeMultisigWaitResult =
  | {
      readonly _tag: "success";
      readonly onchainHash: Hash;
      readonly receipt: TransactionReceipt;
      readonly safeTxHash: Hash;
    }
  | {
      readonly _tag: "queued";
      readonly confirmations: number | null;
      readonly confirmationsRequired: number | null;
      readonly lastStatus: SafeMultisigTxStatus;
      readonly onchainHash: null;
      readonly safeTxHash: Hash;
    }
  | { readonly _tag: "cancelled"; readonly onchainHash: null; readonly safeTxHash: Hash }
  | {
      readonly _tag: "failed";
      readonly error: string;
      // Known once the tx reverted on-chain; `null` only when Safe rejected before submission.
      readonly onchainHash: Hash | null;
      readonly safeTxHash: Hash;
    };

export type SafeMultisigTxStatus =
  | "awaiting_confirmations"
  | "awaiting_execution"
  | "pending"
  | "success"
  | "cancelled"
  | "failed";

function mapStatus(raw: string | undefined): SafeMultisigTxStatus {
  switch (raw) {
    case "AWAITING_CONFIRMATIONS":
      return "awaiting_confirmations";
    case "AWAITING_EXECUTION":
      return "awaiting_execution";
    case "SUCCESS":
      return "success";
    case "CANCELLED":
      return "cancelled";
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

/**
 * Convert a retryable Safe lookup error into an `Option.none` (so the poll loop continues),
 * and re-fail on terminal lookup errors. Reused for both `getTx` and receipt fetches.
 */
function handleRetryablePoll<T>(context: string, attempt: number, safeTxHash: Hash) {
  return (error: SafeMultisigTxLookupError) => {
    if (error.retryable) {
      return Effect.logWarning(context).pipe(
        Effect.annotateLogs({ attempt, error: error.message, safeTxHash }),
        Effect.as(Option.none<T>())
      );
    }
    return Effect.fail(error);
  };
}

function resolveTerminalWaitResult(
  queued: SafeMultisigTxInfo,
  safeTxHash: Hash,
  getReceipt: (hash: Hash) => Effect.Effect<TransactionReceipt, SafeMultisigTxLookupError>
): Effect.Effect<Option.Option<SafeMultisigWaitResult>, SafeMultisigTxLookupError> {
  // Cancelled before any on-chain hash is known — purely a Safe-side decision.
  if (queued.status === "CANCELLED") {
    return Effect.succeed(
      Option.some({
        _tag: "cancelled" as const,
        onchainHash: null,
        safeTxHash,
      } satisfies SafeMultisigWaitResult)
    );
  }

  // FAILED with no hash — Safe rejected before submission (rare).
  if (queued.status === "FAILED" && Option.isNone(queued.onchainHash)) {
    return Effect.succeed(
      Option.some({
        _tag: "failed" as const,
        error: "Safe transaction failed",
        onchainHash: null,
        safeTxHash,
      } satisfies SafeMultisigWaitResult)
    );
  }

  // On-chain hash is the source of truth once present, regardless of indexer-lagged status.
  // The Safe Transaction Service can lag the on-chain inclusion by minutes (especially on
  // Arbitrum and for Gelato-relayed sponsored txs), so don't wait for `txStatus === SUCCESS`.
  if (Option.isSome(queued.onchainHash)) {
    const txHash = queued.onchainHash.value as Hash;
    return getReceipt(txHash).pipe(
      Effect.map((receipt) => {
        if (receipt.status === "reverted") {
          return Option.some({
            _tag: "failed" as const,
            error: `Transaction ${txHash} reverted on-chain`,
            onchainHash: txHash,
            safeTxHash,
          } satisfies SafeMultisigWaitResult);
        }
        return Option.some({
          _tag: "success" as const,
          onchainHash: txHash,
          receipt,
          safeTxHash,
        } satisfies SafeMultisigWaitResult);
      })
    );
  }

  // No on-chain hash yet (AWAITING_*, PENDING, or SUCCESS without indexed hash) — keep polling.
  return Effect.succeed(Option.none());
}

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
 * On timeout this returns a "queued" result with `onchainHash: null` and the
 * original `safeTxHash` so callers can persist and resume tracking later.
 *
 * Resolution is driven by `onchainHash` presence, not by the gateway's `txStatus`. The Safe
 * Transaction Service can lag on-chain inclusion (notably on Arbitrum and for sponsored relays)
 * but typically populates `txHash` earlier; we use the receipt itself to decide success vs.
 * reverted.
 *
 * @param safeTxHash  - The Safe transaction hash returned by `sendTxs`
 * @param getReceipt  - Caller-provided effect to fetch an on-chain receipt. If the tx is not yet
 *                      mined, the caller MUST surface that as a retryable
 *                      `SafeMultisigTxLookupError` (`retryable: true`) so the poll loop keeps
 *                      iterating. Non-retryable errors short-circuit the wait with a failure.
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
  // Guarantee at least one poll even when `maxWait < interval` (e.g. `maxWait: "3 seconds"` with
  // the 5s default interval). Otherwise an already-executed tx would be reported `queued` without
  // ever calling `getTx`.
  const maxAttempts = Math.max(
    1,
    Math.floor(Duration.toMillis(maxWait) / Duration.toMillis(interval))
  );

  const safeApps = yield* SafeAppsService;
  let lastInfo: SafeMultisigTxInfo | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // --- Fetch tx status, classifying errors ---
    const queuedResult = yield* safeApps
      .getTx(safeTxHash)
      .pipe(
        Effect.map(Option.some),
        Effect.catchTag(
          "SafeMultisigTxLookupError",
          handleRetryablePoll<SafeMultisigTxInfo>(
            "Retryable error polling Safe tx",
            attempt,
            safeTxHash
          )
        )
      );

    if (Option.isSome(queuedResult)) {
      const queued = queuedResult.value;
      lastInfo = queued;
      yield* Effect.logDebug("Safe tx poll status").pipe(
        Effect.annotateLogs({
          attempt,
          hash: Option.isSome(queued.onchainHash) ? queued.onchainHash.value : "pending",
          safeTxHash,
          status: queued.status,
        })
      );

      // Surface the per-poll info so callers can observe non-terminal transitions. Hook failures
      // must not interrupt polling, so swallow them.
      if (options.onProgress) {
        yield* options.onProgress(queued).pipe(Effect.catchAllCause(() => Effect.void));
      }

      const terminalResult = yield* resolveTerminalWaitResult(queued, safeTxHash, getReceipt).pipe(
        Effect.catchTag(
          "SafeMultisigTxLookupError",
          handleRetryablePoll<SafeMultisigWaitResult>(
            "Retryable error fetching receipt during Safe tx poll",
            attempt,
            safeTxHash
          )
        )
      );
      if (Option.isSome(terminalResult)) {
        return terminalResult.value;
      }
    }

    // Still pending (no info, retryable error, or non-terminal status) — sleep before next attempt.
    if (attempt < maxAttempts - 1) {
      yield* Effect.sleep(interval);
    }
  }

  // Timed out without reaching a terminal state
  yield* Effect.logWarning("Safe multisig transaction polling timeout").pipe(
    Effect.annotateLogs({
      maxAttempts,
      maxWaitMs: Duration.toMillis(maxWait),
      safeTxHash,
    })
  );

  return {
    _tag: "queued" as const,
    confirmations: lastInfo?.confirmations ?? null,
    confirmationsRequired: lastInfo?.confirmationsRequired ?? null,
    lastStatus: mapStatus(lastInfo?.status),
    onchainHash: null,
    safeTxHash,
  } satisfies SafeMultisigWaitResult;
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
  return mapStatus(queued.status);
});
