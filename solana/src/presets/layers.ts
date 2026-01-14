import { Layer } from "effect";
import type { BalanceService } from "@/src/balance/index.js";
import { BalanceServiceLive } from "@/src/balance/index.js";
import type { PdaService } from "@/src/pda/index.js";
import { PdaServiceLive } from "@/src/pda/index.js";
import type { ProgramWriter } from "@/src/program/index.js";
import { ProgramWriterLive } from "@/src/program/index.js";
import type { RpcService } from "@/src/rpc/index.js";
import { makeRpcServiceLive } from "@/src/rpc/index.js";
import type { SignerService, WalletAdapter } from "@/src/signer/index.js";
import { makeSignerServiceFromAdapter } from "@/src/signer/index.js";
import type { TokenService } from "@/src/token/index.js";
import { TokenServiceLive } from "@/src/token/index.js";
import type { TransactionService } from "@/src/tx/index.js";
import { TransactionServiceLive } from "@/src/tx/index.js";
import type { Cluster, ClusterConfig } from "@/src/types/index.js";

/**
 * Configuration for connecting to a Solana cluster.
 *
 * @category Configuration
 */
export type SolanaClusterConfig = {
  /**
   * The cluster environment (mainnet-beta, devnet, testnet, localnet).
   */
  readonly cluster: Cluster;

  /**
   * Override the default RPC URL for the cluster.
   */
  readonly rpcUrl?: string;

  /**
   * Optional WebSocket URL for subscriptions.
   */
  readonly wsUrl?: string;
};

/**
 * Default RPC endpoints for Solana clusters.
 */
const DEFAULT_RPC_URLS: Record<Cluster, string> = {
  devnet: "https://api.devnet.solana.com",
  localnet: "http://127.0.0.1:8899",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  testnet: "https://api.testnet.solana.com",
};

/**
 * Default WebSocket endpoints for Solana clusters.
 */
const DEFAULT_WS_URLS: Record<Cluster, string | undefined> = {
  devnet: "wss://api.devnet.solana.com",
  localnet: "ws://127.0.0.1:8900",
  "mainnet-beta": "wss://api.mainnet-beta.solana.com",
  testnet: "wss://api.testnet.solana.com",
};

/**
 * Create an RpcService layer from cluster configuration.
 *
 * @param config - Cluster configuration
 * @returns A Layer providing RpcService
 *
 * @category Layers
 *
 * @example
 * ```typescript
 * const rpcLayer = makeRpcLayer({ cluster: "devnet" });
 *
 * // Override default RPC URL
 * const customRpcLayer = makeRpcLayer({
 *   cluster: "mainnet-beta",
 *   rpcUrl: "https://my-custom-rpc.com",
 * });
 * ```
 */
export function makeRpcLayer(config: SolanaClusterConfig): Layer.Layer<RpcService> {
  const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URLS[config.cluster];
  const wsUrl = config.wsUrl ?? DEFAULT_WS_URLS[config.cluster];

  const clusterConfig: ClusterConfig = {
    cluster: config.cluster,
    rpcUrl,
    ...(wsUrl ? { wsUrl } : {}),
  };

  return makeRpcServiceLive(clusterConfig);
}

/**
 * Compose all application services (Balance, Token, Transaction, PDA, ProgramWriter).
 * Requires RpcService and SignerService to be provided.
 *
 * @category Layers
 *
 * @example
 * ```typescript
 * import { Layer } from "effect";
 * import { makeRpcLayer, makeSignerLayer, effectSolanaServices } from "@prb/effect-solana";
 *
 * const rpcLayer = makeRpcLayer({ cluster: "devnet" });
 * const signerLayer = makeSignerLayer(walletAdapter);
 *
 * const appLayer = Layer.provideMerge(
 *   effectSolanaServices,
 *   Layer.mergeAll(rpcLayer, signerLayer)
 * );
 * ```
 */
export const effectSolanaServices = Layer.mergeAll(
  BalanceServiceLive,
  TokenServiceLive,
  TransactionServiceLive,
  PdaServiceLive,
  ProgramWriterLive
);

/**
 * Create a SignerService layer from a wallet adapter.
 *
 * @param getAdapter - Function that returns the current wallet adapter
 * @returns A Layer providing SignerService
 *
 * @category Layers
 *
 * @example
 * ```typescript
 * import { useWallet } from "@solana/wallet-adapter-react";
 *
 * function App() {
 *   const wallet = useWallet();
 *
 *   const signerLayer = makeSignerLayer(() => ({
 *     publicKey: wallet.publicKey,
 *     connected: wallet.connected,
 *     signTransaction: wallet.signTransaction!,
 *     signAllTransactions: wallet.signAllTransactions!,
 *   }));
 *
 *   // Use signerLayer in your runtime...
 * }
 * ```
 */
export function makeSignerLayer(getAdapter: () => WalletAdapter): Layer.Layer<SignerService> {
  return makeSignerServiceFromAdapter(getAdapter);
}

/**
 * Create a complete Solana layer with all services.
 *
 * @param config - Cluster configuration
 * @param getAdapter - Function that returns the current wallet adapter
 * @returns A Layer providing all Solana services
 *
 * @category Layers
 *
 * @example
 * ```typescript
 * import { makeSolanaLayer } from "@prb/effect-solana";
 * import { useWallet } from "@solana/wallet-adapter-react";
 *
 * function App() {
 *   const wallet = useWallet();
 *
 *   const solanaLayer = makeSolanaLayer(
 *     { cluster: "devnet" },
 *     () => ({
 *       publicKey: wallet.publicKey,
 *       connected: wallet.connected,
 *       signTransaction: wallet.signTransaction!,
 *       signAllTransactions: wallet.signAllTransactions!,
 *     })
 *   );
 *
 *   // Use solanaLayer in your Effect runtime...
 * }
 * ```
 */
export function makeSolanaLayer(
  config: SolanaClusterConfig,
  getAdapter: () => WalletAdapter
): Layer.Layer<
  | RpcService
  | SignerService
  | BalanceService
  | TokenService
  | TransactionService
  | PdaService
  | ProgramWriter
> {
  const rpcLayer = makeRpcLayer(config);
  const signerLayer = makeSignerLayer(getAdapter);

  const baseLayers = Layer.mergeAll(rpcLayer, signerLayer);

  return Layer.provideMerge(effectSolanaServices, baseLayers);
}
