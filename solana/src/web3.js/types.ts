import type { Address } from "@solana/addresses";
import { address } from "@solana/addresses";

/**
 * Legacy wallet adapter interface matching @solana/web3.js v1.x patterns.
 *
 * @category Compatibility
 *
 * @example
 * ```typescript
 * import type { LegacyWalletAdapter } from "@prb/effect-solana/compat";
 *
 * const adapter: LegacyWalletAdapter = {
 *   publicKey: walletProvider?.publicKey ?? null,
 *   connected: !!walletProvider?.publicKey,
 *   signTransaction: walletProvider.signTransaction.bind(walletProvider),
 *   signAllTransactions: walletProvider.signAllTransactions.bind(walletProvider),
 * };
 * ```
 */
export type LegacyWalletAdapter = {
  readonly publicKey: unknown | null; // PublicKey from @solana/web3.js
  readonly connected: boolean;
  readonly signTransaction: <T>(tx: T) => Promise<T>; // T = Transaction | VersionedTransaction
  readonly signAllTransactions: <T>(txs: T[]) => Promise<T[]>;
};

/**
 * Convert a legacy PublicKey to a modern Address.
 *
 * @param pk - PublicKey from @solana/web3.js
 * @returns Address string (base58)
 *
 * @category Compatibility
 *
 * @example
 * ```typescript
 * import { publicKeyToAddress } from "@prb/effect-solana/compat";
 * import { PublicKey } from "@solana/web3.js";
 *
 * const pk = new PublicKey("11111111111111111111111111111111");
 * const addr = publicKeyToAddress(pk);
 * // => "11111111111111111111111111111111" as Address
 * ```
 */
export function publicKeyToAddress(pk: { toBase58(): string }): Address {
  return address(pk.toBase58());
}

/**
 * Convert a modern Address to a legacy PublicKey.
 *
 * Uses dynamic import for tree-shaking when @solana/web3.js is not needed.
 *
 * @param addr - Address string
 * @returns PublicKey from @solana/web3.js
 *
 * @category Compatibility
 *
 * @example
 * ```typescript
 * import { addressToPublicKey } from "@prb/effect-solana/compat";
 *
 * const addr = address("11111111111111111111111111111111");
 * const pk = await addressToPublicKey(addr);
 * // => PublicKey instance
 * ```
 */
export async function addressToPublicKey(addr: Address): Promise<unknown> {
  try {
    const { PublicKey } = await import("@solana/web3.js");
    return new PublicKey(addr);
  } catch (error) {
    throw new Error(
      "@solana/web3.js is required for legacy compatibility. Install it as a peer dependency.",
      { cause: error }
    );
  }
}
