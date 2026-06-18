import type { Address } from "@solana/addresses";
import { address } from "@solana/addresses";

export type Web3PublicKeyLike = {
  readonly toBase58: () => string;
};

export type Web3AccountLike = {
  readonly address?: string | null;
};

export type Web3WalletIdentity = {
  readonly account?: Web3AccountLike | null;
  readonly accounts?: readonly (Web3AccountLike | string)[] | null;
  readonly address?: string | null;
  readonly connected?: boolean;
  readonly publicKey?: unknown | null;
};

export type Web3ConnectionLike = unknown;

export type Web3SignAdapter = Web3WalletIdentity & {
  readonly signAllTransactions?: <T>(txs: T[]) => Promise<T[]>;
  readonly signTransaction?: <T>(tx: T) => Promise<T>;
};

export type Web3SendAdapter = Web3WalletIdentity & {
  readonly connection?: Web3ConnectionLike;
  readonly sendTransaction?: (
    tx: unknown,
    connection: Web3ConnectionLike,
    options?: unknown
  ) => Promise<string>;
};

export type AppKitSolanaProvider = Web3SendAdapter & Partial<Web3SignAdapter>;

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
export type LegacyWalletAdapter = Web3WalletIdentity & {
  readonly connected: boolean;
  readonly publicKey: unknown | null; // PublicKey from @solana/web3.js
  readonly signAllTransactions: <T>(txs: T[]) => Promise<T[]>;
  readonly signTransaction: <T>(tx: T) => Promise<T>; // T = Transaction | VersionedTransaction
};

export function hasSendTransaction(adapter: Web3SendAdapter): adapter is Web3SendAdapter & {
  readonly sendTransaction: NonNullable<Web3SendAdapter["sendTransaction"]>;
} {
  return typeof adapter.sendTransaction === "function";
}

export function hasSignTransaction(adapter: Web3SignAdapter): adapter is Web3SignAdapter & {
  readonly signTransaction: NonNullable<Web3SignAdapter["signTransaction"]>;
} {
  return typeof adapter.signTransaction === "function";
}

export function hasSignAllTransactions(adapter: Web3SignAdapter): adapter is Web3SignAdapter & {
  readonly signAllTransactions: NonNullable<Web3SignAdapter["signAllTransactions"]>;
} {
  return typeof adapter.signAllTransactions === "function";
}

export function hasPublicKey(value: unknown): value is Web3PublicKeyLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "toBase58" in value &&
    typeof value.toBase58 === "function"
  );
}

function accountToAddress(account: Web3AccountLike | string | null | undefined): Address | null {
  if (typeof account === "string") {
    return address(account);
  }

  if (account?.address) {
    return address(account.address);
  }

  return null;
}

export function getWeb3WalletAddress(wallet: Web3WalletIdentity): Address | null {
  if (hasPublicKey(wallet.publicKey)) {
    return publicKeyToAddress(wallet.publicKey);
  }

  const directAddress = accountToAddress(wallet.address);
  if (directAddress) {
    return directAddress;
  }

  const accountAddress = accountToAddress(wallet.account);
  if (accountAddress) {
    return accountAddress;
  }

  return accountToAddress(wallet.accounts?.[0]);
}

export function isWeb3WalletConnected(wallet: Web3WalletIdentity): boolean {
  if (wallet.connected !== undefined) {
    return wallet.connected;
  }

  try {
    return getWeb3WalletAddress(wallet) !== null;
  } catch {
    return false;
  }
}

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
export function publicKeyToAddress(pk: Web3PublicKeyLike): Address {
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
