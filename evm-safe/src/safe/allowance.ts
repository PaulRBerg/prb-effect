/**
 * Safe multisig allowance batching.
 *
 * Prepends an ERC-20 approve() tx to a main tx and submits both as a
 * single atomic Safe batch. Every dApp doing token operations through
 * Safe needs this "approve + action" pattern.
 *
 * @module safe/allowance
 */

import { Effect } from "effect";
import type { Address, Hash } from "viem";
import { encodeFunctionData, erc20Abi } from "viem";
import { safeMultisigBatchWrite } from "./batch.js";
import { SafeMultiSendUnavailableError } from "./errors.js";
import type { SafeMultisigTx } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters for Safe multisig allowance batching. */
export type SafeMultisigAllowAndWriteParams = {
  /** Main transaction to execute after approval. */
  readonly mainTransaction: SafeMultisigTx;
  /** Spender contract that needs the allowance. */
  readonly spender: Address;
  /** Token to approve. */
  readonly token: {
    readonly address: Address;
    readonly chainId: number;
  };
  /** Approval amount (e.g. MaxUint256 or a computed amount). */
  readonly amount: bigint;
  /**
   * MultiSend behavior:
   * - "require": fail if MultiSend is unavailable
   * - "fallback-required-approval": submit separate Safe proposals for approve and main tx
   */
  readonly multiSendStrategy?: "require" | "fallback-required-approval";
};

export type SafeMultisigAllowAndWriteResult =
  | {
      readonly _tag: "batched";
      readonly safeTxHash: Hash;
    }
  | {
      readonly _tag: "fallback-required-approval";
      readonly approveSafeTxHash: Hash;
      readonly mainSafeTxHash: Hash;
    };

/** Parameters for building a standalone ERC-20 approve tx. */
export type SafeMultisigApproveTxParams = {
  /** Approval amount. */
  readonly amount: bigint;
  /** Spender contract that needs the allowance. */
  readonly spender: Address;
  /** Token contract address. */
  readonly tokenAddress: Address;
};

// ---------------------------------------------------------------------------
// buildSafeApproveTx
// ---------------------------------------------------------------------------

/**
 * Encode an ERC-20 `approve(spender, amount)` call as a Safe transaction.
 */
export function buildSafeApproveTx(params: SafeMultisigApproveTxParams): SafeMultisigTx {
  const { amount, spender, tokenAddress } = params;

  const data = encodeFunctionData({
    abi: erc20Abi,
    args: [spender, amount],
    functionName: "approve",
  });

  return { data, to: tokenAddress, value: 0n };
}

// ---------------------------------------------------------------------------
// safeMultisigAllowAndWrite
// ---------------------------------------------------------------------------

/**
 * Batch an ERC-20 approve tx with a main tx as a single Safe proposal.
 *
 * Approve is placed first so the allowance is set before the main contract
 * interaction. Both execute atomically — Safe users sign once.
 *
 * On chains where MultiSend is not deployed, fails with
 * `SafeMultiSendUnavailableError`. Callers should catch that tag and fall
 * back to sequential approve → action flow.
 */
export const safeMultisigAllowAndWrite = Effect.fn("safeMultisigAllowAndWrite")(function* (
  params: SafeMultisigAllowAndWriteParams
) {
  const { amount, mainTransaction, spender, token } = params;
  const strategy = params.multiSendStrategy ?? "require";

  const approveTx = buildSafeApproveTx({
    amount,
    spender,
    tokenAddress: token.address,
  });

  // Approve first, then main transaction
  const batched = yield* safeMultisigBatchWrite([approveTx, mainTransaction], token.chainId).pipe(
    Effect.either
  );

  if (batched._tag === "Right") {
    return {
      _tag: "batched",
      safeTxHash: batched.right,
    } satisfies SafeMultisigAllowAndWriteResult;
  }

  const error = batched.left;

  if (!(error instanceof SafeMultiSendUnavailableError) || strategy === "require") {
    return yield* Effect.fail(error);
  }

  // Fallback for chains without MultiSend: submit two standalone Safe tx proposals.
  const approveSafeTxHash = yield* safeMultisigBatchWrite([approveTx], token.chainId);
  const mainSafeTxHash = yield* safeMultisigBatchWrite([mainTransaction], token.chainId);

  return {
    _tag: "fallback-required-approval",
    approveSafeTxHash,
    mainSafeTxHash,
  } satisfies SafeMultisigAllowAndWriteResult;
});
