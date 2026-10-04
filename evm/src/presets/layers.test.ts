import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import type { Transport } from "viem";
import { HttpRequestError, RpcRequestError } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { BalanceService } from "#src/balance/index.js";
import { BlockService } from "#src/block/index.js";
import { ContractReader, ContractWriter } from "#src/contract/index.js";
import { PublicClientService, WalletClientService } from "#src/core/index.js";
import { DeployService } from "#src/deploy/index.js";
import { Erc721Service } from "#src/erc721/index.js";
import { EventStream } from "#src/events/index.js";
import { GasService } from "#src/gas/index.js";
import { NonceService } from "#src/nonce/index.js";
import {
  effectEvmServices,
  makeEffectEvmLayer,
  makePublicClientLayer,
  makeWalletClientLayer,
} from "#src/presets/index.js";
import { SignatureService } from "#src/signature/index.js";
import { SimulationService } from "#src/simulation/index.js";
import { SubscriptionService } from "#src/subscriptions/index.js";
import { TxManager } from "#src/tx/index.js";

describe("Preset Layers", () => {
  describe("makePublicClientLayer", () => {
    it.effect("creates layer that returns client for configured chainId", () =>
      Effect.gen(function* () {
        const service = yield* PublicClientService;
        const client = yield* service.get(1);

        expect(client).toBeDefined();
        expect(client.transport.type).toBe("http");
      }).pipe(
        Effect.provide(
          makePublicClientLayer([
            {
              chain: mainnet,
              chainId: mainnet.id,
              rpcUrls: ["https://eth-mainnet.example.com"],
            },
          ])
        )
      )
    );

    it.effect("returns ClientNotFoundError for unconfigured chainId", () =>
      Effect.gen(function* () {
        const service = yield* PublicClientService;
        const exit = yield* service.get(999).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          makePublicClientLayer([
            {
              chain: mainnet,
              chainId: mainnet.id,
              rpcUrls: ["https://eth-mainnet.example.com"],
            },
          ])
        )
      )
    );

    it.effect("uses fallback transport when multiple rpcUrls are provided", () =>
      Effect.gen(function* () {
        const service = yield* PublicClientService;
        const client = yield* service.get(1);

        expect(client.transport.type).toBe("fallback");
      }).pipe(
        Effect.provide(
          makePublicClientLayer([
            {
              chain: mainnet,
              chainId: mainnet.id,
              rpcUrls: ["https://rpc-1.example.com", "https://rpc-2.example.com"],
            },
          ])
        )
      )
    );

    it.effect("prefers ws for subscriptions when wsUrls are provided", () =>
      Effect.gen(function* () {
        const service = yield* PublicClientService;
        const client = yield* service.get(1);
        expect(client.transport.type).toBe("fallback");
        const value = client.transport;
        const hasSubscribe =
          typeof value === "object" &&
          value !== null &&
          "subscribe" in value &&
          typeof (value as { subscribe?: unknown }).subscribe === "function";
        expect(hasSubscribe).toBe(true);
      }).pipe(
        Effect.provide(
          makePublicClientLayer([
            {
              chain: mainnet,
              chainId: mainnet.id,
              rpcUrls: ["https://eth-mainnet.example.com"],
              wsUrls: ["wss://eth-mainnet.example.com/ws"],
            },
          ])
        )
      )
    );

    it.effect("supports middleware: dedup coalesces safe in-flight requests", () => {
      let calls = 0;
      const baseTransport = (() => {
        const request = (async () => {
          calls += 1;
          await new Promise((r) => setTimeout(r, 20));
          return "0x1";
        }) as unknown;

        return {
          config: {
            key: "test",
            name: "test",
            request,
            type: "custom",
          },
          request,
        };
      }) as unknown as Transport;

      return Effect.gen(function* () {
        const service = yield* PublicClientService;
        const client = yield* service.get(1);
        const request = client.request;

        yield* Effect.promise(() =>
          Promise.all([request({ method: "eth_chainId" }), request({ method: "eth_chainId" })])
        );
        expect(calls).toBe(1);
      }).pipe(
        Effect.provide(
          makePublicClientLayer([
            {
              chain: mainnet,
              chainId: mainnet.id,
              rpcMiddleware: { dedup: true },
              rpcUrls: ["https://eth-mainnet.example.com"],
              transport: baseTransport,
            },
          ])
        )
      );
    });

    it.effect("supports middleware: circuit breaker opens after failures", () => {
      let calls = 0;
      const failingTransport = (() => {
        const request = (() => {
          calls += 1;
          return Promise.reject(new Error("boom"));
        }) as unknown;

        return {
          config: {
            key: "test",
            name: "test",
            request,
            type: "custom",
          },
          request,
        };
      }) as unknown as Transport;

      return Effect.gen(function* () {
        const service = yield* PublicClientService;
        const client = yield* service.get(1);
        const request = client.request;

        const first = yield* Effect.tryPromise({
          catch: (e) => e,
          try: () => request({ method: "eth_chainId" }),
        }).pipe(Effect.result);
        expect(first._tag).toBe("Failure");

        const second = yield* Effect.tryPromise({
          catch: (e) => e,
          try: () => request({ method: "eth_chainId" }),
        }).pipe(Effect.result);
        expect(second._tag).toBe("Failure");
        const error = second._tag === "Failure" ? second.failure : undefined;
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("circuit breaker");
        expect(calls).toBe(1);
      }).pipe(
        Effect.provide(
          makePublicClientLayer([
            {
              chain: mainnet,
              chainId: mainnet.id,
              rpcUrls: ["https://eth-mainnet.example.com"],
              transport: failingTransport,
              rpcMiddleware: {
                circuitBreaker: {
                  failureThreshold: 1,
                  resetTimeoutMs: 60_000,
                },
              },
            },
          ])
        )
      );
    });
  });

  describe("rpcMiddleware transport (A5)", () => {
    type RequestFn = (req: { method: string; params?: unknown }) => Promise<unknown>;

    /** Build a minimal viem-shaped transport from a request implementation. */
    const makeTransport = (request: RequestFn): Transport =>
      (() => {
        const fn = request as unknown;
        return {
          config: { key: "test", name: "test", request: fn, type: "custom" },
          request: fn,
        };
      }) as unknown as Transport;

    /** Resolve the wrapped client.request for a given chain config. */
    const getRequest = (config: Parameters<typeof makePublicClientLayer>[0][number]) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PublicClientService;
          const client = yield* service.get(config.chainId);
          return client.request as RequestFn;
        }).pipe(Effect.provide(makePublicClientLayer([config])))
      );

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("re-opens the breaker after the reset window elapses (re-stamps openedAtMs)", async () => {
      let nowMs = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => nowMs);

      let calls = 0;
      const request = getRequest({
        chain: mainnet,
        chainId: mainnet.id,
        rpcUrls: ["https://eth-mainnet.example.com"],
        transport: makeTransport(() => {
          calls += 1;
          return Promise.reject(
            new HttpRequestError({ status: 502, url: "https://eth-mainnet.example.com" })
          );
        }),
        rpcMiddleware: {
          circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 1000 },
        },
      });
      const req = await request;

      const fail = async () => {
        try {
          await req({ method: "eth_blockNumber" });
        } catch {
          /* expected */
        }
      };

      // Two transport failures open the circuit.
      await fail();
      await fail();
      expect(calls).toBe(2);

      // Open: rejected without hitting the transport.
      await fail();
      expect(calls).toBe(2);

      // Advance past the reset window; the next call is admitted (trial)...
      nowMs += 1500;
      await fail();
      expect(calls).toBe(3);

      // ...and because it failed again, the breaker MUST re-open (re-stamp), not stay
      // half-open forever. The following call is rejected without a transport hit.
      await fail();
      expect(calls).toBe(3);
    });

    it("does not raise an unhandled rejection when a deduped request fails", async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);

      try {
        const request = getRequest({
          chain: mainnet,
          chainId: mainnet.id,
          rpcMiddleware: { dedup: true },
          rpcUrls: ["https://eth-mainnet.example.com"],
          transport: makeTransport(async () => {
            await new Promise((r) => setTimeout(r, 5));
            throw new Error("boom");
          }),
        });
        const req = await request;

        // Two concurrent deduped calls share one in-flight promise; both reject.
        const results = await Promise.allSettled([
          req({ method: "eth_blockNumber" }),
          req({ method: "eth_blockNumber" }),
        ]);
        expect(results.every((r) => r.status === "rejected")).toBe(true);

        // Let the derived cleanup chain settle.
        await new Promise((r) => setTimeout(r, 10));
        expect(unhandled).toHaveLength(0);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });

    it("does not count JSON-RPC application errors (reverts) toward the breaker", async () => {
      let calls = 0;
      const request = getRequest({
        chain: mainnet,
        chainId: mainnet.id,
        rpcUrls: ["https://eth-mainnet.example.com"],
        transport: makeTransport(() => {
          calls += 1;
          // A contract designed to revert on eth_call surfaces as RpcRequestError.
          return Promise.reject(
            new RpcRequestError({
              body: { method: "eth_call" },
              error: { code: 3, message: "execution reverted" },
              url: "https://eth-mainnet.example.com",
            })
          );
        }),
        rpcMiddleware: {
          circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 60_000 },
        },
      });
      const req = await request;

      const revert = async () => {
        try {
          await req({ method: "eth_call" });
        } catch {
          /* expected */
        }
      };

      // Five reverts must NOT open the breaker: every call reaches the transport.
      for (let i = 0; i < 5; i++) {
        await revert();
      }
      expect(calls).toBe(5);
    });

    it("counts a concurrently-deduped transport failure only once", async () => {
      let physicalCalls = 0;
      const request = getRequest({
        chain: mainnet,
        chainId: mainnet.id,
        rpcUrls: ["https://eth-mainnet.example.com"],
        transport: makeTransport(async () => {
          physicalCalls += 1;
          await new Promise((r) => setTimeout(r, 5));
          throw new HttpRequestError({ status: 503, url: "https://eth-mainnet.example.com" });
        }),
        rpcMiddleware: {
          circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 60_000 },
          dedup: true,
        },
      });
      const req = await request;

      // Three concurrent waiters on ONE physical failing request. Because the breaker
      // sits below dedup, this counts as a single failure, not three.
      await Promise.allSettled([
        req({ method: "eth_blockNumber" }),
        req({ method: "eth_blockNumber" }),
        req({ method: "eth_blockNumber" }),
      ]);
      expect(physicalCalls).toBe(1);

      // failureThreshold is 2, so a single counted failure leaves the breaker closed:
      // the next batch must reach the transport again (would be blocked if it had
      // counted 3 failures from the first batch).
      await Promise.allSettled([
        req({ method: "eth_blockNumber" }),
        req({ method: "eth_blockNumber" }),
      ]);
      expect(physicalCalls).toBe(2);
    });
  });

  describe("makeWalletClientLayer", () => {
    it.effect("creates layer from mock provider", () =>
      Effect.gen(function* () {
        const service = yield* WalletClientService;
        const client = yield* service.get(1);

        expect(client).toBeDefined();
      }).pipe(
        Effect.provide(
          makeWalletClientLayer({ request: async () => "0x1" }, new Map([[1, mainnet]]))
        )
      )
    );

    it.effect("returns WalletNotConnectedError for missing chain", () =>
      Effect.gen(function* () {
        const service = yield* WalletClientService;
        const exit = yield* service.get(999).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          makeWalletClientLayer({ request: async () => "0x1" }, new Map([[1, mainnet]]))
        )
      )
    );
  });

  describe("effectEvmServices", () => {
    it.effect("successfully merges all service layers when provided client layers", () =>
      Effect.gen(function* () {
        // Verify all services are accessible
        const balance = yield* BalanceService;
        const block = yield* BlockService;
        const reader = yield* ContractReader;
        const writer = yield* ContractWriter;
        const deploy = yield* DeployService;
        const erc721 = yield* Erc721Service;
        const txManager = yield* TxManager;
        const eventStream = yield* EventStream;
        const gas = yield* GasService;
        const nonce = yield* NonceService;
        const signature = yield* SignatureService;
        const simulation = yield* SimulationService;
        const subscription = yield* SubscriptionService;

        expect(balance).toBeDefined();
        expect(block).toBeDefined();
        expect(reader).toBeDefined();
        expect(writer).toBeDefined();
        expect(deploy).toBeDefined();
        expect(erc721).toBeDefined();
        expect(txManager).toBeDefined();
        expect(eventStream).toBeDefined();
        expect(gas).toBeDefined();
        expect(nonce).toBeDefined();
        expect(signature).toBeDefined();
        expect(simulation).toBeDefined();
        expect(subscription).toBeDefined();
      }).pipe(
        Effect.provide(
          Layer.provide(
            effectEvmServices,
            Layer.merge(
              makePublicClientLayer([
                {
                  chain: mainnet,
                  chainId: mainnet.id,
                  rpcUrls: ["https://eth-mainnet.example.com"],
                },
              ]),
              makeWalletClientLayer({ request: async () => "0x1234" }, new Map([[1, mainnet]]))
            )
          )
        )
      )
    );
  });

  describe("makeEffectEvmLayer", () => {
    it.effect("creates complete layer with all services accessible", () =>
      Effect.gen(function* () {
        // Verify all client services are accessible
        const publicService = yield* PublicClientService;
        const walletService = yield* WalletClientService;

        // Verify all high-level services are accessible
        const balance = yield* BalanceService;
        const block = yield* BlockService;
        const reader = yield* ContractReader;
        const writer = yield* ContractWriter;
        const deploy = yield* DeployService;
        const erc721 = yield* Erc721Service;
        const txManager = yield* TxManager;
        const eventStream = yield* EventStream;
        const gas = yield* GasService;
        const nonce = yield* NonceService;
        const signature = yield* SignatureService;
        const simulation = yield* SimulationService;
        const subscription = yield* SubscriptionService;

        expect(publicService).toBeDefined();
        expect(walletService).toBeDefined();
        expect(balance).toBeDefined();
        expect(block).toBeDefined();
        expect(reader).toBeDefined();
        expect(writer).toBeDefined();
        expect(deploy).toBeDefined();
        expect(erc721).toBeDefined();
        expect(txManager).toBeDefined();
        expect(eventStream).toBeDefined();
        expect(gas).toBeDefined();
        expect(nonce).toBeDefined();
        expect(signature).toBeDefined();
        expect(simulation).toBeDefined();
        expect(subscription).toBeDefined();

        // Verify we can get clients for both chains
        const mainnetClient = yield* publicService.get(1);
        const sepoliaClient = yield* publicService.get(11_155_111);

        expect(mainnetClient).toBeDefined();
        expect(sepoliaClient).toBeDefined();
      }).pipe(
        Effect.provide(
          makeEffectEvmLayer(
            [
              {
                chain: mainnet,
                chainId: mainnet.id,
                rpcUrls: ["https://eth-mainnet.example.com"],
              },
              {
                chain: sepolia,
                chainId: 11_155_111,
                rpcUrls: ["https://eth-sepolia.example.com"],
              },
            ],
            { request: async () => "0x1234" }
          )
        )
      )
    );
  });
});
