import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option, Stream } from "effect";
import type { Address } from "viem";
import { mainnet, polygon } from "viem/chains";
import { makeMockWalletProvider } from "#src/testing-kit/index.js";
import { makeWalletServiceLive, WalletService } from "#src/wallet/index.js";

describe("WalletService", () => {
  describe("currentAccount", () => {
    it.effect("returns first account from eth_accounts", () =>
      Effect.gen(function* () {
        const service = yield* WalletService;
        const account = yield* service.currentAccount;

        expect(account).toBe("0x1234567890123456789012345678901234567890");
      }).pipe(
        Effect.provide(
          makeWalletServiceLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "eth_accounts") {
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

    it.effect("fails with AccountNotConnectedError when empty", () =>
      Effect.gen(function* () {
        const service = yield* WalletService;
        const exit = yield* Effect.exit(service.currentAccount);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value._tag).toBe("AccountNotConnectedError");
            expect(error.value.message).toBe("No wallet account connected");
          }
        }
      }).pipe(
        Effect.provide(
          makeWalletServiceLive(
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
  });

  describe("currentChainId", () => {
    it.effect("parses hex to number", () =>
      Effect.gen(function* () {
        const service = yield* WalletService;
        const chainId = yield* service.currentChainId;

        expect(chainId).toBe(polygon.id);
      }).pipe(
        Effect.provide(
          makeWalletServiceLive(
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

    it.effect("fails when request fails", () =>
      Effect.gen(function* () {
        const service = yield* WalletService;
        const exit = yield* Effect.exit(service.currentChainId);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.failureOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value._tag).toBe("AccountNotConnectedError");
          }
        }
      }).pipe(
        Effect.provide(
          makeWalletServiceLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "eth_chainId") {
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

  describe("accounts stream", () => {
    it.effect("emits initial accounts", () =>
      Effect.gen(function* () {
        const service = yield* WalletService;
        const accountsStream = yield* service.accounts;
        const firstEmission = yield* Stream.runHead(accountsStream);

        expect(Option.isSome(firstEmission)).toBe(true);
        if (Option.isSome(firstEmission)) {
          expect(firstEmission.value).toEqual(["0x1234567890123456789012345678901234567890"]);
        }
      }).pipe(
        Effect.provide(
          makeWalletServiceLive(
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
  });

  describe("chainId stream", () => {
    it.effect("emits initial chainId", () =>
      Effect.gen(function* () {
        const service = yield* WalletService;
        const chainIdStream = yield* service.chainId;
        const firstEmission = yield* Stream.runHead(chainIdStream);

        expect(Option.isSome(firstEmission)).toBe(true);
        if (Option.isSome(firstEmission)) {
          expect(firstEmission.value).toBe(1);
        }
      }).pipe(
        Effect.provide(
          makeWalletServiceLive(
            makeMockWalletProvider({
              request: ({ method }) => {
                if (method === "eth_chainId") {
                  return Promise.resolve("0x1"); // 1 in hex
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );
  });

  describe("signMessage", () => {
    it.effect("delegates to operations module", () =>
      Effect.gen(function* () {
        const service = yield* WalletService;
        const signature = yield* service.signMessage({
          account: "0x1234567890123456789012345678901234567890" as Address,
          message: "Hello",
        });

        expect(signature).toBe("0xsignature");
      }).pipe(
        Effect.provide(
          makeWalletServiceLive(
            makeMockWalletProvider({
              request: ({ method, params }) => {
                if (method === "personal_sign") {
                  expect(params).toEqual(["Hello", "0x1234567890123456789012345678901234567890"]);
                  return Promise.resolve("0xsignature");
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );
  });

  describe("signTypedData", () => {
    it.effect("delegates to operations module", () =>
      Effect.gen(function* () {
        const service = yield* WalletService;
        const signature = yield* service.signTypedData({
          account: "0x1234567890123456789012345678901234567890" as Address,
          domain: { chainId: mainnet.id, name: "Test" },
          message: { test: "value" },
          primaryType: "Test",
          types: {
            Test: [{ name: "test", type: "string" }],
          },
        });

        expect(signature).toBe("0xsignature");
      }).pipe(
        Effect.provide(
          makeWalletServiceLive(
            makeMockWalletProvider({
              request: ({ method, params }) => {
                if (method === "eth_signTypedData_v4") {
                  expect((params as unknown[])?.[0]).toBe(
                    "0x1234567890123456789012345678901234567890"
                  );
                  return Promise.resolve("0xsignature");
                }
                return Promise.resolve();
              },
            })
          )
        )
      )
    );
  });

  describe("signTransaction", () => {
    it.effect("delegates to operations module", () =>
      Effect.gen(function* () {
        const service = yield* WalletService;
        const signedTx = yield* service.signTransaction({
          from: "0x1234567890123456789012345678901234567890" as Address,
          to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
        });

        expect(signedTx).toBe("0xsignedtx");
      }).pipe(
        Effect.provide(
          makeWalletServiceLive(
            makeMockWalletProvider({
              request: ({ method, params }) => {
                if (method === "eth_signTransaction") {
                  const tx = (params as [{ from: Address; to: Address }])[0];
                  expect(tx.from).toBe("0x1234567890123456789012345678901234567890");
                  expect(tx.to).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
                  return Promise.resolve("0xsignedtx");
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
