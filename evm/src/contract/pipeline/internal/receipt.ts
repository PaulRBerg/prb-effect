import { Effect } from "effect";
import type { Hash, TransactionReceipt } from "viem";
import type { ClientNotFoundError, ReceiptTimeoutError, TxFailedError } from "#src/core/index.js";
import type { TxManagerShape, TxPolicy } from "#src/tx/index.js";

export type OnReplacedCallback = (
  oldHash: Hash,
  newHash: Hash,
  reason: string
) => Effect.Effect<void>;

/**
 * Wait for receipt, following any transaction replacements.
 * The onReplaced callback is invoked each time a replacement is detected.
 */
export const waitForReceiptFollowingReplacements = (
  txManager: TxManagerShape,
  params: {
    chainId: number;
    hash: Hash;
    policy: TxPolicy;
    onReplaced?: OnReplacedCallback;
  }
): Effect.Effect<TransactionReceipt, TxFailedError | ReceiptTimeoutError | ClientNotFoundError> =>
  Effect.gen(function* () {
    let waitHash = params.hash;

    while (true) {
      const exit = yield* txManager
        .waitForReceipt(params.chainId, waitHash, params.policy)
        .pipe(Effect.result);

      if (exit._tag === "Success") {
        return exit.success;
      }

      const error = exit.failure;
      if (error._tag === "TxReplacedError") {
        const oldHash = error.oldHash as Hash;
        const newHash = error.newHash as Hash;

        if (params.onReplaced) {
          yield* params.onReplaced(oldHash, newHash, error.reason);
        }

        waitHash = newHash;
        continue;
      }

      return yield* Effect.fail(error);
    }
  });
