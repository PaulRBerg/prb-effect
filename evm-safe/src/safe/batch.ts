/**
 * Safe multisig batch transaction operations.
 *
 * Send multiple transactions as an atomic Safe batch using SafeAppsSDK.
 * Detects MultiSend contract unavailability and surfaces it as a typed error.
 *
 * @module safe/batch
 */

import { Effect } from "effect";
import {
  getSafeErrorMessage,
  isMultiSendUnavailableError,
  SafeMultiSendUnavailableError,
  SafeMultisigTxSubmissionError,
} from "./errors.js";
import { SafeAppsService } from "./service.js";
import type { SafeMultisigTx } from "./types.js";

/**
 * Send multiple transactions as a single Safe multisig batch.
 *
 * Uses SafeAppsService to atomically execute all transactions via MultiSend.
 * On chains where MultiSend is not deployed, fails with `SafeMultiSendUnavailableError`.
 *
 * @param transactions - Array of transactions to batch
 * @param chainId - Optional chain ID for error context
 */
export const safeMultisigBatchWrite = Effect.fn("safeMultisigBatchWrite")(function* (
  transactions: readonly [SafeMultisigTx, ...SafeMultisigTx[]],
  chainId?: number
) {
  const safeApps = yield* SafeAppsService;
  const result = yield* safeApps.sendTxs(transactions).pipe(
    Effect.mapError((error) => {
      if (isMultiSendUnavailableError(error)) {
        return new SafeMultiSendUnavailableError({
          cause: error,
          chainId,
          message: `MultiSend contract not available on chain ${chainId ?? "unknown"}`,
        });
      }

      if (error instanceof SafeMultisigTxSubmissionError) {
        return error;
      }

      const detail = getSafeErrorMessage(error);
      return new SafeMultisigTxSubmissionError({
        cause: error,
        message: detail ? `Safe batch write failed: ${detail}` : "Safe batch write failed",
      });
    })
  );
  return result.safeTxHash;
});
