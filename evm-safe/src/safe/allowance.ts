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
import type { Address } from "viem";
import { encodeFunctionData, erc20Abi } from "viem";
import { safeMultisigBatchWrite } from "./batch.js";
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

  const approveTx = buildSafeApproveTx({
    amount,
    spender,
    tokenAddress: token.address,
  });

  // Approve first, then main transaction
  return yield* safeMultisigBatchWrite([approveTx, mainTransaction], token.chainId);
});
