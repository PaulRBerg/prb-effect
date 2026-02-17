import type { Address, Hash } from "viem";

const DEFAULT_SAFE_APP_ORIGIN = "https://app.safe.global";

export type GetSafeMultisigTxUrlParams = {
  /** Safe account address */
  safeAddress: Address;
  /** Safe transaction hash (proposal hash) */
  safeTxHash: Hash;
  /** Optional Safe app origin (default: https://app.safe.global) */
  safeAppOrigin?: string;
  /**
   * Optional `safe` query value expected by Safe UI.
   * Example: `eth:0x...` or `sep:0x...`.
   */
  safe?: string;
};

/**
 * Build a Safe web URL for a Safe transaction details page.
 *
 * This points to Safe's multisig tx route (`/transactions/tx`) and includes the
 * tx identifier derived from `safeAddress` and `safeTxHash`.
 */
export function getSafeMultisigTxUrl(params: GetSafeMultisigTxUrlParams): string {
  const { safeAddress, safeAppOrigin = DEFAULT_SAFE_APP_ORIGIN, safeTxHash, safe } = params;

  const url = new URL("/transactions/tx", safeAppOrigin);
  url.searchParams.set("id", `multisig_${safeAddress}_${safeTxHash}`);

  if (safe) {
    url.searchParams.set("safe", safe);
  }

  return url.toString();
}
