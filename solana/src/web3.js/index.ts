/**
 * Legacy @solana/web3.js compatibility layer.
 *
 * This module provides utilities for bridging between legacy @solana/web3.js v1.x
 * wallet adapters and the modern @solana/kit v2.x types used by @prb/effect-solana.
 *
 * @module @prb/effect-solana/compat
 *
 * @remarks
 * Requires `@solana/web3.js` v1.95.0+ to be installed as a peer dependency.
 *
 * @example
 * ```typescript
 * import { makeSolanaLayerWithLegacyAdapter } from "@prb/effect-solana/compat";
 *
 * const layer = makeSolanaLayerWithLegacyAdapter(
 *   { cluster: "devnet" },
 *   () => ({
 *     publicKey: walletProvider?.publicKey ?? null,
 *     connected: !!walletProvider?.publicKey,
 *     signTransaction: walletProvider.signTransaction.bind(walletProvider),
 *     signAllTransactions: walletProvider.signAllTransactions.bind(walletProvider),
 *   })
 * );
 * ```
 */

export * from "./layers.js";
export * from "./legacy-signer.js";
export * from "./transaction-bridge.js";
export * from "./types.js";
