import { FetchHttpClient } from "@effect/platform";
import { Effect, Layer, Option } from "effect";
import type { Chain, PublicClient, Transport, WalletClient } from "viem";
import { createPublicClient, createWalletClient, custom, fallback, webSocket } from "viem";
import type { BalanceService } from "@/src/balance/index.js";
import { BalanceServiceLive } from "@/src/balance/index.js";
import type { BlockService } from "@/src/block/index.js";
import { BlockServiceLive } from "@/src/block/index.js";
import type { ContractPipeline, ContractReader, ContractWriter } from "@/src/contract/index.js";
import {
  ContractPipelineLive,
  ContractReaderLive,
  ContractWriterLive,
} from "@/src/contract/index.js";
import {
  ClientNotFoundError,
  PublicClientService,
  WalletClientService,
  WalletNotConnectedError,
  WrongNetworkError,
} from "@/src/core/index.js";
import type { DeployService } from "@/src/deploy/index.js";
import { DeployServiceLive } from "@/src/deploy/index.js";
import type { Eip7702Service } from "@/src/eip7702/index.js";
import { Eip7702ServiceLive } from "@/src/eip7702/index.js";
import type { EnsResolver } from "@/src/ens/index.js";
import { EnsResolverLive } from "@/src/ens/index.js";
import type { Erc721Service } from "@/src/erc721/index.js";
import { Erc721ServiceLive } from "@/src/erc721/index.js";
import type {
  CursorStore,
  CursorStream,
  EventBackfill,
  EventStream,
  ReliableEventStream,
} from "@/src/events/index.js";
import {
  CursorStreamLive,
  EventBackfillLive,
  EventStreamLive,
  InMemoryCursorStoreLive,
  ReliableEventStreamLive,
} from "@/src/events/index.js";
import type { GasService } from "@/src/gas/index.js";
import { GasServiceLive } from "@/src/gas/index.js";
import { parseHexInt } from "@/src/internal/index.js";
import type { NonceService } from "@/src/nonce/index.js";
import { NonceServiceLive } from "@/src/nonce/index.js";
import type { ChainHead, ContractQuery, MulticallBatcher, QueryClient } from "@/src/query/index.js";
import {
  ChainHeadLive,
  ContractQueryLive,
  MulticallBatcherLive,
  QueryClientLive,
} from "@/src/query/index.js";
import type { RequestDedup, RpcCache } from "@/src/rpc/index.js";
import { makeRpcCacheLive, RequestDedupLive } from "@/src/rpc/index.js";
import type { SignatureService } from "@/src/signature/index.js";
import { SignatureServiceLive } from "@/src/signature/index.js";
import type { SimulationService } from "@/src/simulation/index.js";
import { SimulationServiceLive } from "@/src/simulation/index.js";
import type { SubscriptionService } from "@/src/subscriptions/index.js";
import { SubscriptionServiceLive } from "@/src/subscriptions/index.js";
import type { TxManager, TxReplacement } from "@/src/tx/index.js";
import { TxManagerLive, TxReplacementLive } from "@/src/tx/index.js";
import type { WalletLifecycle, WalletProvider, WalletService } from "@/src/wallet/index.js";
import {
  makeWalletLifecycleLive,
  makeWalletProviderRefLive,
  makeWalletServiceLive,
  WalletLifecycleFromProviderRefLive,
  WalletProviderRef,
  WalletServiceFromProviderRefLive,
} from "@/src/wallet/index.js";
import type { HttpTransportOptions } from "./transports.js";
import { makeHttpTransport } from "./transports.js";

const UNKNOWN_CHAIN_ID = 0;

export type TransportRetryConfig = {
  /** The max number of times to retry. */
  readonly retryCount?: number | undefined;
  /** Base delay (in ms) between retries. */
  readonly retryDelay?: number | undefined;
  /** Timeout (in ms) for requests. */
  readonly timeout?: number | undefined;
};

export type TransportCircuitBreakerConfig = {
  /**
   * Open the circuit after this many consecutive failures.
   * @default 5
   */
  readonly failureThreshold?: number | undefined;
  /**
   * Time (ms) to keep the circuit open before allowing a trial request.
   * @default 15_000
   */
  readonly resetTimeoutMs?: number | undefined;
};

export type RpcMiddlewareConfig = {
  /**
   * Transport-level retry options (applied to URL-based transports).
   * Note: viem also has built-in retry for some transports; this config is passed through.
   */
  readonly retry?: TransportRetryConfig | undefined;
  /** Simple circuit breaker guarding transport request/subscribe */
  readonly circuitBreaker?: TransportCircuitBreakerConfig | undefined;
  /**
   * Optional in-flight request dedup for safe methods only.
   * Safe-method allowlist is intentionally strict.
   */
  readonly dedup?: boolean | undefined;
};

export type ChainConfig = {
  readonly chainId: number;
  readonly chain: Chain;
  /** HTTP RPC URLs (fallback order). Required unless `transport` is provided. */
  readonly rpcUrls: readonly string[];
  /** Optional WS RPC URLs (fallback order). Used for subscription-backed operations when present. */
  readonly wsUrls?: readonly string[] | undefined;
  /**
   * Escape hatch: provide a fully constructed viem transport.
   * Takes precedence over `rpcUrls`/`wsUrls`/`http` options.
   */
  readonly transport?: Transport | undefined;
  /** HTTP transport options applied per URL when building from `rpcUrls`. */
  readonly http?: TransportRetryConfig | undefined;
  /** WebSocket transport options applied per URL when building from `wsUrls`. */
  readonly ws?:
    | (TransportRetryConfig & {
        readonly keepAlive?: boolean | undefined;
        readonly reconnect?: boolean | undefined;
      })
    | undefined;
  /** Optional middleware wrappers. */
  readonly rpcMiddleware?: RpcMiddlewareConfig | undefined;
};

const toHttpOptions = (retry: TransportRetryConfig | undefined): HttpTransportOptions => ({
  retryCount: retry?.retryCount,
  retryDelay: retry?.retryDelay,
  timeout: retry?.timeout,
});

const safeMethodAllowlist = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "net_version",
]);

const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));

const withDedup =
  (transport: Transport): Transport =>
  (args) => {
    const inner = transport(args);
    const inflight = new Map<string, ReturnType<typeof inner.request>>();

    const request = ((rpcRequest: unknown) => {
      const method = (rpcRequest as { method?: unknown }).method;
      if (typeof method !== "string" || !safeMethodAllowlist.has(method)) {
        return inner.request(rpcRequest as never);
      }

      const chainId = args.chain?.id ?? "unknown";
      const key = `${chainId}:${method}:${stableStringify((rpcRequest as { params?: unknown }).params)}`;

      const existing = inflight.get(key);
      if (existing) {
        return existing;
      }

      const promise = inner.request(rpcRequest as never);
      inflight.set(key, promise);

      (promise as Promise<unknown>).finally(() => {
        inflight.delete(key);
      });

      return promise;
    }) as unknown as typeof inner.request;

    return { ...inner, request };
  };

const withCircuitBreaker = (
  transport: Transport,
  config: TransportCircuitBreakerConfig
): Transport => {
  const failureThreshold = config.failureThreshold ?? 5;
  const resetTimeoutMs = config.resetTimeoutMs ?? 15_000;

  let consecutiveFailures = 0;
  let openedAtMs: number | undefined;

  const isOpen = (): boolean =>
    openedAtMs !== undefined && Date.now() - openedAtMs < resetTimeoutMs;

  const noteFailure = () => {
    consecutiveFailures += 1;
    if (consecutiveFailures >= failureThreshold && openedAtMs === undefined) {
      openedAtMs = Date.now();
    }
  };

  const noteSuccess = () => {
    consecutiveFailures = 0;
    openedAtMs = undefined;
  };

  return (args) => {
    const inner = transport(args);

    const request = ((rpcRequest: unknown) => {
      if (isOpen()) {
        return Promise.reject(new Error("RPC circuit breaker is open")) as ReturnType<
          typeof inner.request
        >;
      }

      const result = inner.request(rpcRequest as never);
      return (result as Promise<unknown>).then(
        (resultValue) => {
          noteSuccess();
          return resultValue;
        },
        (e) => {
          noteFailure();
          throw e;
        }
      ) as ReturnType<typeof inner.request>;
    }) as unknown as typeof inner.request;

    const value = (() => {
      const v = inner.value;
      if (typeof v !== "object" || v === null) {
        return v;
      }
      if (!("subscribe" in v)) {
        return v;
      }

      const subscribeValue = (v as { subscribe?: unknown }).subscribe;
      if (typeof subscribeValue !== "function") {
        return v;
      }

      const subscribe = subscribeValue as (
        ...subscribeArgs: readonly unknown[]
      ) => Promise<unknown>;

      return {
        ...(v as Record<string, unknown>),
        subscribe: async (...subscribeArgs: readonly unknown[]) => {
          if (isOpen()) {
            throw new Error("RPC circuit breaker is open");
          }

          try {
            const result = await subscribe(...subscribeArgs);
            noteSuccess();
            return result;
          } catch (e) {
            noteFailure();
            throw e;
          }
        },
      };
    })();

    return { ...inner, request, value };
  };
};

const makePublicTransportForChain = (config: ChainConfig): Transport => {
  const middlewareRetry = config.rpcMiddleware?.retry;
  const httpOptions = toHttpOptions(config.http ?? middlewareRetry);

  const baseTransport =
    config.transport ??
    (() => {
      if (config.rpcUrls.length === 0) {
        throw new Error(
          `Invalid ChainConfig for chainId=${config.chainId}: rpcUrls must be non-empty when transport is not provided`
        );
      }

      const httpTransports = config.rpcUrls.map((url) =>
        makeHttpTransport({ url, ...httpOptions })
      );
      const httpTransport =
        httpTransports.length === 1 ? httpTransports[0] : fallback(httpTransports);

      const wsUrls = config.wsUrls ?? [];
      if (wsUrls.length === 0) {
        return httpTransport;
      }

      const wsConfig = config.ws ?? middlewareRetry;
      const wsTransports = wsUrls.map((url) =>
        webSocket(url, {
          keepAlive: config.ws?.keepAlive,
          reconnect: config.ws?.reconnect,
          retryCount: wsConfig?.retryCount,
          retryDelay: wsConfig?.retryDelay,
          timeout: wsConfig?.timeout,
        })
      );
      const wsTransport = wsTransports.length === 1 ? wsTransports[0] : fallback(wsTransports);

      // Prefer WS for subscription-backed flows, while keeping HTTP fallback for requests.
      // `fallback()` does not reliably preserve `subscribe`, so stitch `subscribe` back in from WS.
      const requestTransport = fallback([wsTransport, httpTransport]);
      return (args) => {
        const req = requestTransport(args);
        const ws = wsTransport(args);
        const wsValue = ws.value;

        const subscribe =
          typeof wsValue === "object" &&
          wsValue !== null &&
          "subscribe" in wsValue &&
          typeof (wsValue as { subscribe?: unknown }).subscribe === "function"
            ? (wsValue as { subscribe: unknown }).subscribe
            : undefined;

        return subscribe
          ? {
              ...req,
              value: { ...(req.value as Record<string, unknown>), subscribe },
            }
          : req;
      };
    })();

  const deduped = config.rpcMiddleware?.dedup ? withDedup(baseTransport) : baseTransport;
  const circuitBreaker =
    config.rpcMiddleware?.circuitBreaker !== undefined
      ? withCircuitBreaker(deduped, config.rpcMiddleware.circuitBreaker)
      : deduped;

  return circuitBreaker;
};

/**
 * Create a PublicClientService layer from chain configurations
 */
export function makePublicClientLayer(configs: ChainConfig[]): Layer.Layer<PublicClientService> {
  const clients = new Map<number, PublicClient>();

  for (const config of configs) {
    const client = createPublicClient({
      chain: config.chain,
      transport: makePublicTransportForChain(config),
    });
    clients.set(config.chainId, client);
  }

  return Layer.succeed(PublicClientService, {
    get: (chainId: number) =>
      Effect.gen(function* () {
        const client = clients.get(chainId);
        if (!client) {
          return yield* Effect.fail(
            new ClientNotFoundError({
              chainId,
              message: `No public client found for chain ${chainId}`,
            })
          );
        }
        return client;
      }),
  });
}

/**
 * Create a WalletClientService layer from an EIP-1193 provider
 */
export function makeWalletClientLayer(
  provider: { request: (...args: unknown[]) => Promise<unknown> },
  chains: Map<number, Chain>
): Layer.Layer<WalletClientService> {
  return Layer.succeed(WalletClientService, {
    get: (chainId: number) =>
      Effect.gen(function* () {
        const chain = chains.get(chainId);
        if (!chain) {
          return yield* Effect.fail(
            new WalletNotConnectedError({
              chainId,
              message: `No chain configuration found for chain ${chainId}`,
            })
          );
        }

        const actualChainId = yield* Effect.tryPromise({
          catch: (cause) =>
            new WalletNotConnectedError({
              chainId,
              message:
                cause instanceof Error
                  ? cause.message
                  : `Failed to read wallet chainId for ${chainId}`,
            }),
          try: async () => {
            const hex = await provider.request({ method: "eth_chainId" });
            if (typeof hex !== "string") {
              throw new Error("Invalid eth_chainId response");
            }
            return Option.getOrElse(parseHexInt(hex), () => UNKNOWN_CHAIN_ID);
          },
        });

        if (actualChainId !== chainId) {
          return yield* Effect.fail(
            new WrongNetworkError({
              actualChainId,
              expectedChainId: chainId,
              message: `Wallet is on chainId=${actualChainId} but expected chainId=${chainId}`,
            })
          );
        }

        const client = createWalletClient({
          chain,
          transport: custom(provider),
        });

        return client as WalletClient;
      }),
  });
}

/**
 * Create a WalletClientService layer from a dynamic provider ref.
 *
 * This is the key building block for "stable runtime" frontends: the runtime stays alive,
 * while the provider can be set/cleared/changed without reconstructing the Layer/Runtime.
 */
export function makeWalletClientLayerFromProviderRef(
  chains: Map<number, Chain>
): Layer.Layer<WalletClientService, never, WalletProviderRef> {
  return Layer.effect(
    WalletClientService,
    Effect.gen(function* () {
      const providerRef = yield* WalletProviderRef;

      return WalletClientService.of({
        get: (chainId: number) =>
          Effect.gen(function* () {
            const chain = chains.get(chainId);
            if (!chain) {
              return yield* Effect.fail(
                new WalletNotConnectedError({
                  chainId,
                  message: `No chain configuration found for chain ${chainId}`,
                })
              );
            }

            const current = yield* providerRef.get;
            if (Option.isNone(current)) {
              return yield* Effect.fail(
                new WalletNotConnectedError({
                  chainId,
                  message: "No wallet provider set",
                })
              );
            }

            const provider = current.value;
            const actualChainId = yield* Effect.tryPromise({
              catch: (cause) =>
                new WalletNotConnectedError({
                  chainId,
                  message:
                    cause instanceof Error
                      ? cause.message
                      : `Failed to read wallet chainId for ${chainId}`,
                }),
              try: async () => {
                const hex = await provider.request({ method: "eth_chainId" });
                if (typeof hex !== "string") {
                  throw new Error("Invalid eth_chainId response");
                }
                return Option.getOrElse(parseHexInt(hex), () => UNKNOWN_CHAIN_ID);
              },
            });

            if (actualChainId !== chainId) {
              return yield* Effect.fail(
                new WrongNetworkError({
                  actualChainId,
                  expectedChainId: chainId,
                  message: `Wallet is on chainId=${actualChainId} but expected chainId=${chainId}`,
                })
              );
            }

            const client = createWalletClient({
              chain,
              transport: custom(provider),
            });

            return client as WalletClient;
          }),
      });
    })
  );
}

/**
 * Compose all effect-evm services into a single layer
 * Requires PublicClientService and WalletClientService to be provided
 * Note: WalletService and WalletLifecycle require a provider and should be added via makeEffectEvmLayer
 */
const cursorServices = Layer.mergeAll(EventStreamLive, EventBackfillLive, InMemoryCursorStoreLive);

const cursorStreamServices = Layer.provideMerge(CursorStreamLive, cursorServices);

const baseServices = Layer.mergeAll(
  BlockServiceLive,
  ContractReaderLive,
  ContractWriterLive,
  Erc721ServiceLive,
  cursorServices,
  cursorStreamServices,
  EnsResolverLive,
  GasServiceLive,
  NonceServiceLive,
  SignatureServiceLive,
  SubscriptionServiceLive,
  makeRpcCacheLive(),
  RequestDedupLive
);

const txServices = Layer.provideMerge(
  TxManagerLive,
  Layer.provideMerge(TxReplacementLive, baseServices)
);

const queryServices = Layer.provideMerge(
  ContractQueryLive,
  Layer.provideMerge(
    MulticallBatcherLive,
    Layer.provideMerge(QueryClientLive, Layer.provideMerge(ChainHeadLive, txServices))
  )
);

export const effectEvmServices = Layer.provideMerge(
  Layer.mergeAll(
    BalanceServiceLive,
    ContractPipelineLive,
    Eip7702ServiceLive,
    DeployServiceLive,
    ReliableEventStreamLive,
    SimulationServiceLive
  ),
  queryServices
).pipe(Layer.provide(FetchHttpClient.layer));

/**
 * Create a complete effect-evm layer from chain configurations and provider
 */
export function makeEffectEvmLayer(
  configs: ChainConfig[],
  provider: { request: (...args: unknown[]) => Promise<unknown> }
): Layer.Layer<
  | PublicClientService
  | WalletClientService
  | BalanceService
  | BlockService
  | ChainHead
  | ContractReader
  | ContractQuery
  | ContractWriter
  | ContractPipeline
  | Eip7702Service
  | DeployService
  | Erc721Service
  | GasService
  | NonceService
  | QueryClient
  | MulticallBatcher
  | RpcCache
  | RequestDedup
  | SignatureService
  | SimulationService
  | SubscriptionService
  | TxManager
  | TxReplacement
  | EventBackfill
  | EventStream
  | CursorStore
  | CursorStream
  | ReliableEventStream
  | EnsResolver
  | WalletService
  | WalletLifecycle
> {
  const chains = new Map(configs.map((c) => [c.chainId, c.chain]));

  const clientLayers = Layer.mergeAll(
    makePublicClientLayer(configs),
    makeWalletClientLayer(provider, chains)
  );

  const walletLayers = Layer.mergeAll(
    makeWalletServiceLive(provider),
    makeWalletLifecycleLive(provider)
  );

  return Layer.provideMerge(Layer.mergeAll(effectEvmServices, walletLayers), clientLayers);
}

/**
 * Create a complete effect-evm layer with a dynamic wallet provider reference.
 *
 * This is intended for frontends (e.g. Next.js) that want a stable Effect runtime
 * while the wallet provider changes over time.
 *
 * Set/clear the provider by using `WalletProviderRef` (e.g. from React via `useForkEffect`).
 */
export function makeEffectEvmLayerWithWalletProviderRef(
  configs: ChainConfig[],
  initialProvider?: WalletProvider | undefined
): Layer.Layer<
  | PublicClientService
  | WalletClientService
  | BalanceService
  | BlockService
  | ChainHead
  | ContractReader
  | ContractQuery
  | ContractWriter
  | ContractPipeline
  | Eip7702Service
  | DeployService
  | Erc721Service
  | GasService
  | NonceService
  | QueryClient
  | MulticallBatcher
  | RpcCache
  | RequestDedup
  | SignatureService
  | SimulationService
  | SubscriptionService
  | TxManager
  | TxReplacement
  | EventBackfill
  | EventStream
  | CursorStore
  | CursorStream
  | ReliableEventStream
  | EnsResolver
  | WalletService
  | WalletLifecycle
  | WalletProviderRef
> {
  const chains = new Map(configs.map((c) => [c.chainId, c.chain]));
  const providerRefLayer = makeWalletProviderRefLive(initialProvider);

  const walletClientLayer = Layer.provideMerge(
    makeWalletClientLayerFromProviderRef(chains),
    providerRefLayer
  );

  const clientLayers = Layer.mergeAll(makePublicClientLayer(configs), walletClientLayer);

  const walletLayers = Layer.provideMerge(
    Layer.mergeAll(WalletServiceFromProviderRefLive, WalletLifecycleFromProviderRefLive),
    providerRefLayer
  );

  return Layer.provideMerge(
    Layer.mergeAll(effectEvmServices, walletLayers, providerRefLayer),
    clientLayers
  );
}
