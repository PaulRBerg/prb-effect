/**
 * Size limit enforcement for Safe simulation calldata.
 */
import { Effect } from "effect";
import type { Hex } from "viem";
import { TxSizeTooLargeError } from "../../errors.js";

/**
 * Enforce chain-specific transaction size constraints (if provided).
 */
export function enforceTxSizeLimit(
  safeCalldata: Hex,
  txSizeLimit?: number
): Effect.Effect<void, TxSizeTooLargeError> {
  if (!txSizeLimit) {
    return Effect.void;
  }

  return Effect.gen(function* () {
    const sizeInBytes = (safeCalldata.length - 2) / 2;
    if (sizeInBytes > txSizeLimit) {
      return yield* Effect.fail(
        new TxSizeTooLargeError({
          actualSize: sizeInBytes,
          maxSize: txSizeLimit,
          message: `Transaction size (${sizeInBytes} bytes) exceeds chain limit (${txSizeLimit} bytes). Try splitting into smaller batches.`,
        })
      );
    }
  });
}
