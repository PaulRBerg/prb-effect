import { Layer } from "effect";
import type { BalanceService } from "#src/balance/index.js";
import type { PdaService } from "#src/pda/index.js";
import type { SolanaClusterConfig } from "#src/presets/index.js";
import {
  effectSolanaServices,
  effectSolanaServicesWithWalletSend,
  makeRpcLayer,
} from "#src/presets/index.js";
import type { ProgramReader, ProgramWriter } from "#src/program/index.js";
import type { RpcService } from "#src/rpc/index.js";
import type { SignerService } from "#src/signer/index.js";
import type { TokenService } from "#src/token/index.js";
import type { TransactionService } from "#src/tx/index.js";
import { makeWalletSendServiceFromAppKitProvider } from "./appkit-sender.js";
import {
  makeSignerServiceFromLegacyAdapter,
  makeSignerServiceFromWeb3Adapter,
} from "./legacy-signer.js";
import type { AppKitSolanaProvider, LegacyWalletAdapter, Web3ConnectionLike } from "./types.js";

/**
 * Create a complete Solana layer using a legacy wallet adapter.
 *
 * This is a convenience factory that combines RPC, signer, and all service layers
 * for use with legacy @solana/web3.js wallet adapters (like @reown/appkit-adapter-solana).
 *
 * @param config - Cluster configuration
 * @param getAdapter - Function that returns the current wallet adapter
 * @returns A Layer providing all Solana services
 *
 * @category Compatibility
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
export function makeSolanaLayerWithLegacyAdapter(
  config: SolanaClusterConfig,
  getAdapter: () => LegacyWalletAdapter
): Layer.Layer<
  | RpcService
  | SignerService
  | BalanceService
  | TokenService
  | TransactionService
  | PdaService
  | ProgramReader
  | ProgramWriter
> {
  const rpcLayer = makeRpcLayer(config);
  const signerLayer = makeSignerServiceFromLegacyAdapter(getAdapter);

  const baseLayers = Layer.mergeAll(rpcLayer, signerLayer);

  return Layer.provideMerge(effectSolanaServices, baseLayers);
}

/**
 * Create a complete Solana layer using a Reown AppKit Solana provider.
 *
 * This supports AppKit's documented `walletProvider.sendTransaction(transaction, connection)`
 * sign-and-send path without requiring AppKit as a package dependency.
 *
 * @param config - Cluster configuration
 * @param getProvider - Function that returns the current AppKit Solana provider
 * @param getConnection - Function that returns AppKit's web3.js Connection
 * @returns A Layer providing all Solana services
 *
 * @category Compatibility
 */
export function makeSolanaLayerWithAppKit(
  config: SolanaClusterConfig,
  getProvider: () => AppKitSolanaProvider | null | undefined,
  getConnection?: () => Web3ConnectionLike | null | undefined
): Layer.Layer<
  | RpcService
  | SignerService
  | BalanceService
  | TokenService
  | TransactionService
  | PdaService
  | ProgramReader
  | ProgramWriter
> {
  const rpcLayer = makeRpcLayer(config);
  const signerLayer = makeSignerServiceFromWeb3Adapter(() => getProvider() ?? {});
  const walletSendLayer = makeWalletSendServiceFromAppKitProvider(getProvider, getConnection);

  const baseLayers = Layer.mergeAll(rpcLayer, signerLayer, walletSendLayer);

  return Layer.provideMerge(effectSolanaServicesWithWalletSend, baseLayers);
}
