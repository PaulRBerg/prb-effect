import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import type { Address } from "viem";
import { polygon } from "viem/chains";
import { makeMockWalletProvider } from "#src/testing-kit/index.js";
import type { AddChainParams, WatchAssetParams } from "#src/wallet/index.js";
import { makeWalletLifecycleLive, WalletLifecycle } from "#src/wallet/index.js";

describe("WalletLifecycle", () => {
  describe("connect", () => {
    it.effect("returns accounts from eth_requestAccounts", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const accounts = yield* lifecycle.connect();

        expect(accounts).toEqual([
          "0x1234567890123456789012345678901234567890",
          "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        ]);
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "eth_requestAccounts") {
                  return Promise.resolve([
                    "0x1234567890123456789012345678901234567890",
                    "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
                  ] as Address[]);
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );

    it.effect("fails with WalletConnectionError when accounts empty", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const exit = yield* Effect.exit(lifecycle.connect());

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value._tag).toBe("WalletConnectionError");
            expect(error.value.message).toBe("No accounts returned from wallet");
          }
        }
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "eth_requestAccounts") {
                  return Promise.resolve([] as Address[]);
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );

    it.effect("user rejection returns UserRejectedError", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const exit = yield* Effect.exit(lifecycle.connect());

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value._tag).toBe("UserRejectedError");
          }
        }
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "eth_requestAccounts") {
                  return Promise.reject(new Error("User rejected the request"));
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );
  });

  describe("disconnect", () => {
    it.effect("completes successfully", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        yield* lifecycle.disconnect();
        // No error means success
        expect(true).toBe(true);
      }).pipe(Effect.provide(makeWalletLifecycleLive(makeMockWalletProvider())))
    );
  });

  describe("isConnected", () => {
    it.effect("returns true when eth_accounts returns non-empty array", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const connected = yield* lifecycle.isConnected;

        expect(connected).toBe(true);
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "eth_accounts") {
                  return Promise.resolve([
                    "0x1234567890123456789012345678901234567890",
                  ] as Address[]);
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );

    it.effect("returns false when eth_accounts returns empty array", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const connected = yield* lifecycle.isConnected;

        expect(connected).toBe(false);
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "eth_accounts") {
                  return Promise.resolve([] as Address[]);
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );

    it.effect("returns false when eth_accounts throws error", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const connected = yield* lifecycle.isConnected;

        expect(connected).toBe(false);
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "eth_accounts") {
                  return Promise.reject(new Error("Provider error"));
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );
  });

  describe("switchChain", () => {
    it.effect("calls wallet_switchEthereumChain with hex chainId", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        yield* lifecycle.switchChain(polygon.id);

        expect(true).toBe(true);
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method, params }) => {
                if (method === "wallet_switchEthereumChain") {
                  expect(params).toEqual([{ chainId: "0x89" }]); // polygon.id in hex
                  return Promise.resolve(null);
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );

    it.effect("user rejection returns UserRejectedError", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const exit = yield* Effect.exit(lifecycle.switchChain(polygon.id));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value._tag).toBe("UserRejectedError");
          }
        }
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "wallet_switchEthereumChain") {
                  return Promise.reject(new Error("User rejected the request"));
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );
  });

  describe("addChain", () => {
    it.effect("converts Chain to EIP-3085 format", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        yield* lifecycle.addChain({
          id: polygon.id,
          name: "Polygon",
          nativeCurrency: {
            decimals: 18,
            name: "MATIC",
            symbol: "MATIC",
          },
          rpcUrls: {
            http: ["https://polygon-rpc.com"],
          },
        } as unknown as AddChainParams);

        expect(true).toBe(true);
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method, params }) => {
                if (method === "wallet_addEthereumChain") {
                  const chainParams = (
                    params as [
                      {
                        chainId: string;
                        chainName: string;
                        nativeCurrency: unknown;
                        rpcUrls: unknown;
                      },
                    ]
                  )[0];
                  expect(chainParams.chainId).toBe("0x89"); // polygon.id in hex
                  expect(chainParams.chainName).toBe("Polygon");
                  expect(chainParams.nativeCurrency).toEqual({
                    decimals: 18,
                    name: "MATIC",
                    symbol: "MATIC",
                  });
                  expect(chainParams.rpcUrls).toEqual(["https://polygon-rpc.com"]);
                  return Promise.resolve(null);
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );

    it.effect("user rejection returns UserRejectedError", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const exit = yield* Effect.exit(
          lifecycle.addChain({
            id: polygon.id,
            name: "Polygon",
            nativeCurrency: {
              decimals: 18,
              name: "MATIC",
              symbol: "MATIC",
            },
            rpcUrls: {
              http: ["https://polygon-rpc.com"],
            },
          } as unknown as AddChainParams)
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value._tag).toBe("UserRejectedError");
          }
        }
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "wallet_addEthereumChain") {
                  return Promise.reject(new Error("User rejected the request"));
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );
  });

  describe("getChainId", () => {
    it.effect("returns numeric chainId from hex response", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const chainId = yield* lifecycle.getChainId();

        expect(chainId).toBe(polygon.id);
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "eth_chainId") {
                  return Promise.resolve("0x89"); // polygon.id in hex
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );
  });

  describe("watchAsset", () => {
    it.effect("returns true when asset is added successfully", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const result = yield* lifecycle.watchAsset({
          type: "ERC20",
          options: {
            address: "0x1234567890123456789012345678901234567890",
            decimals: 18,
            image: "https://example.com/token.png",
            symbol: "TEST",
          },
        } as WatchAssetParams);

        expect(result).toBe(true);
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method, params }) => {
                if (method === "wallet_watchAsset") {
                  expect(params).toEqual({
                    type: "ERC20",
                    options: {
                      address: "0x1234567890123456789012345678901234567890",
                      decimals: 18,
                      image: "https://example.com/token.png",
                      symbol: "TEST",
                    },
                  });
                  return Promise.resolve(true);
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );

    it.effect("user rejection returns UserRejectedError", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const exit = yield* Effect.exit(
          lifecycle.watchAsset({
            type: "ERC20",
            options: {
              address: "0x1234567890123456789012345678901234567890",
              decimals: 18,
              symbol: "TEST",
            },
          } as WatchAssetParams)
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value._tag).toBe("UserRejectedError");
          }
        }
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "wallet_watchAsset") {
                  return Promise.reject(new Error("User rejected the request"));
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );

    it.effect("other errors return WatchAssetError", () =>
      Effect.gen(function* () {
        const lifecycle = yield* WalletLifecycle;
        const exit = yield* Effect.exit(
          lifecycle.watchAsset({
            type: "ERC20",
            options: {
              address: "0x1234567890123456789012345678901234567890",
              decimals: 18,
              symbol: "TEST",
            },
          } as WatchAssetParams)
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value._tag).toBe("WatchAssetError");
            expect(error.value.message).toBe("Provider error");
          }
        }
      }).pipe(
        Effect.provide(
          makeWalletLifecycleLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "wallet_watchAsset") {
                  return Promise.reject(new Error("Provider error"));
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );
  });
});
