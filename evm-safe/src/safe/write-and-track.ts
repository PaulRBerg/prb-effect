import { TxManager } from "@prb/effect-evm/tx";
import { Deferred, Effect, Option, Ref, SubscriptionRef } from "effect";
import type { Hash, TransactionReceipt } from "viem";
import { safeMultisigBatchWrite } from "./batch.js";
import type {
  SafeMultiSendUnavailableError,
  SafeMultisigInfoUnavailableError,
  SafeMultisigTxLookupError,
  SafeMultisigTxSubmissionError,
} from "./errors.js";
import { toSafeMultisigTxLookupError } from "./errors.js";
import { SafeAppsService } from "./service.js";
import type {
  SafeMultisigTxStatus,
  SafeMultisigWaitOptions,
  SafeMultisigWaitResult,
} from "./tx-lifecycle.js";
import { waitForSafeMultisigTx } from "./tx-lifecycle.js";
import type { SafeMultisigTx } from "./types.js";

export type SafeWriteAndTrackState =
  | { readonly status: "submitting" }
  | {
      readonly status: "awaiting_confirmations";
      readonly confirmations: number | null;
      readonly confirmationsRequired: number | null;
      readonly safeTxHash: Hash;
    }
  | {
      readonly status: "awaiting_execution";
      readonly confirmations: number | null;
      readonly confirmationsRequired: number | null;
      readonly safeTxHash: Hash;
    }
  | {
      readonly status: "pending";
      readonly confirmations: number | null;
      readonly confirmationsRequired: number | null;
      readonly safeTxHash: Hash;
    }
  | {
      readonly status: "queued";
      readonly confirmations: number | null;
      readonly confirmationsRequired: number | null;
      readonly lastStatus: SafeMultisigTxStatus;
      readonly safeTxHash: Hash;
    }
  | {
      readonly status: "success";
      readonly onchainHash: Hash;
      readonly receipt: TransactionReceipt;
      readonly safeTxHash: Hash;
    }
  | { readonly status: "cancelled"; readonly safeTxHash: Hash }
  | {
      readonly status: "failed";
      readonly error: string;
      // Known when the failure carries an on-chain hash (e.g. a reverted tx).
      readonly onchainHash?: Hash;
      readonly safeTxHash?: Hash;
    };

export type SafeWriteAndTrackError =
  | SafeMultiSendUnavailableError
  | SafeMultisigInfoUnavailableError
  | SafeMultisigTxLookupError
  | SafeMultisigTxSubmissionError;

export type SafeWriteAndTrackParams = {
  readonly transactions: readonly [SafeMultisigTx, ...SafeMultisigTx[]];
  readonly chainId?: number;
  readonly waitOptions?: SafeMultisigWaitOptions;
  readonly onStateChange?: (state: SafeWriteAndTrackState) => Effect.Effect<void>;
  readonly onSubmitted?: (safeTxHash: Hash) => Effect.Effect<void>;
  readonly onQueued?: (
    result: Extract<SafeMultisigWaitResult, { _tag: "queued" }>
  ) => Effect.Effect<void>;
  readonly onSuccess?: (
    result: Extract<SafeMultisigWaitResult, { _tag: "success" }>
  ) => Effect.Effect<void>;
  readonly onCancelled?: (
    result: Extract<SafeMultisigWaitResult, { _tag: "cancelled" }>
  ) => Effect.Effect<void>;
  readonly onFailed?: (
    result: Extract<SafeMultisigWaitResult, { _tag: "failed" }>
  ) => Effect.Effect<void>;
};

export type SafeWriteAndTrackResult = {
  readonly stateRef: SubscriptionRef.SubscriptionRef<SafeWriteAndTrackState>;
  readonly result: Effect.Effect<SafeMultisigWaitResult, SafeWriteAndTrackError>;
};

/** Non-terminal states produced by mapping Safe poll info. */
type SafePollState = Extract<
  SafeWriteAndTrackState,
  { status: "awaiting_confirmations" | "awaiting_execution" | "pending" }
>;

/**
 * Poll states repeat while nothing changes on the Safe (same status and counts
 * every interval). Compare the observable fields so unchanged polls can be
 * skipped instead of re-emitted to consumers on every tick.
 */
function isSamePollState(current: SafeWriteAndTrackState, next: SafePollState): boolean {
  if (current.status !== next.status) {
    return false;
  }
  const currentPoll = current as SafePollState;
  return (
    currentPoll.confirmations === next.confirmations &&
    currentPoll.confirmationsRequired === next.confirmationsRequired &&
    currentPoll.safeTxHash === next.safeTxHash
  );
}

function mapStatusState(options: {
  safeTxHash: Hash;
  status: string;
  confirmations: number | null;
  confirmationsRequired: number | null;
}): SafePollState {
  const shared = {
    confirmations: options.confirmations,
    confirmationsRequired: options.confirmationsRequired,
    safeTxHash: options.safeTxHash,
  } as const;

  switch (options.status) {
    case "AWAITING_CONFIRMATIONS":
      return { status: "awaiting_confirmations", ...shared };
    case "AWAITING_EXECUTION":
      return { status: "awaiting_execution", ...shared };
    default:
      return { status: "pending", ...shared };
  }
}

function runLifecycle(lifecycle: Effect.Effect<void> | undefined): Effect.Effect<void> {
  if (!lifecycle) {
    return Effect.void;
  }

  return lifecycle.pipe(Effect.catchAll(() => Effect.void));
}

export const safeWriteAndTrack = Effect.fn("safeWriteAndTrack")(function* (
  params: SafeWriteAndTrackParams
) {
  const safeApps = yield* SafeAppsService;
  const txManager = yield* TxManager;
  const stateRef = yield* SubscriptionRef.make<SafeWriteAndTrackState>({
    status: "submitting",
  });
  const safeTxHashRef = yield* Ref.make<Hash | null>(null);
  const resultDeferred = yield* Deferred.make<SafeMultisigWaitResult, SafeWriteAndTrackError>();

  const setState = (state: SafeWriteAndTrackState) =>
    SubscriptionRef.set(stateRef, state).pipe(
      Effect.zipRight(runLifecycle(params.onStateChange?.(state)))
    );

  // Emit a poll-derived state only when it differs from the current one, so an
  // unchanged Safe (same status and confirmation counts every interval) does not
  // re-notify consumers on each poll.
  const setPollState = (state: SafePollState) =>
    SubscriptionRef.get(stateRef).pipe(
      Effect.flatMap((current) => (isSamePollState(current, state) ? Effect.void : setState(state)))
    );

  const program = Effect.gen(function* () {
    const resolvedChainId = params.chainId ?? (yield* safeApps.getInfo()).chainId;
    const safeTxHash = yield* safeMultisigBatchWrite(params.transactions, resolvedChainId);

    yield* Ref.set(safeTxHashRef, safeTxHash);
    yield* runLifecycle(params.onSubmitted?.(safeTxHash));

    const initialInfo = yield* safeApps.getTx(safeTxHash).pipe(Effect.option);
    if (Option.isSome(initialInfo)) {
      yield* setState(
        mapStatusState({
          confirmations: initialInfo.value.confirmations,
          confirmationsRequired: initialInfo.value.confirmationsRequired,
          safeTxHash,
          status: initialInfo.value.status,
        })
      );
    } else {
      yield* setState({
        confirmations: null,
        confirmationsRequired: null,
        safeTxHash,
        status: "pending",
      });
    }

    // Bound each per-iteration receipt fetch so we don't sit on the TxManager default while the
    // relay is still pushing the tx on-chain. The outer poll loop continues retrying on transient
    // failures via `retryable: true`.
    const receiptTimeoutMs = 10_000;
    const waitResult = yield* waitForSafeMultisigTx(
      safeTxHash,
      (onchainHash) =>
        txManager
          .waitForReceipt(resolvedChainId, onchainHash, receiptTimeoutMs)
          .pipe(Effect.mapError((cause) => toSafeMultisigTxLookupError(safeTxHash, cause, true))),
      {
        ...params.waitOptions,
        // Reflect non-terminal poll transitions (confirmation counts, awaiting_* statuses) into the
        // observable state stream. `setState` already swallows `onStateChange` failures, and
        // `waitForSafeMultisigTx` swallows `onProgress` failures, so this never aborts polling.
        // Unchanged polls are deduplicated so consumers only see actual transitions.
        onProgress: (info) =>
          setPollState(
            mapStatusState({
              confirmations: info.confirmations,
              confirmationsRequired: info.confirmationsRequired,
              safeTxHash,
              status: info.status,
            })
          ),
      }
    );

    switch (waitResult._tag) {
      case "success":
        yield* setState({
          onchainHash: waitResult.onchainHash,
          receipt: waitResult.receipt,
          safeTxHash: waitResult.safeTxHash,
          status: "success",
        });
        yield* runLifecycle(params.onSuccess?.(waitResult));
        break;
      case "queued":
        yield* setState({
          confirmations: waitResult.confirmations,
          confirmationsRequired: waitResult.confirmationsRequired,
          lastStatus: waitResult.lastStatus,
          safeTxHash: waitResult.safeTxHash,
          status: "queued",
        });
        yield* runLifecycle(params.onQueued?.(waitResult));
        break;
      case "cancelled":
        yield* setState({
          safeTxHash: waitResult.safeTxHash,
          status: "cancelled",
        });
        yield* runLifecycle(params.onCancelled?.(waitResult));
        break;
      case "failed":
        yield* setState({
          error: waitResult.error,
          // Preserve the on-chain hash when the tx reverted (null only for pre-submission rejects).
          ...(waitResult.onchainHash ? { onchainHash: waitResult.onchainHash } : {}),
          safeTxHash: waitResult.safeTxHash,
          status: "failed",
        });
        yield* runLifecycle(params.onFailed?.(waitResult));
        break;
    }

    return waitResult;
  }).pipe(
    Effect.catchAll((error: SafeWriteAndTrackError) =>
      Effect.gen(function* () {
        const safeTxHash = yield* Ref.get(safeTxHashRef);
        yield* setState({
          error: error.message,
          safeTxHash: safeTxHash ?? undefined,
          status: "failed",
        });

        return yield* Effect.fail(error);
      })
    )
  );

  yield* Effect.forkScoped(
    program.pipe(
      Effect.either,
      Effect.flatMap((either) =>
        either._tag === "Right"
          ? Deferred.succeed(resultDeferred, either.right)
          : Deferred.fail(resultDeferred, either.left)
      ),
      // If the scope closes mid-flight the fiber is interrupted before the Deferred resolves; without
      // this an out-of-scope `Deferred.await(result)` would hang forever. Interrupting the Deferred
      // makes the awaiter fail with interruption instead. No-op once the Deferred has completed.
      Effect.ensuring(Deferred.interrupt(resultDeferred))
    )
  );

  return {
    result: Deferred.await(resultDeferred),
    stateRef,
  };
});
