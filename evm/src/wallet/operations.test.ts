import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import type { Address } from "viem";
import { mainnet } from "viem/chains";
import { makeMockWalletProvider } from "@/src/testing-kit/index.js";
import { signMessage, signTransaction, signTypedData } from "@/src/wallet/index.js";

describe("signMessage", () => {
  it.effect("uses provided account parameter", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[] | Record<string, unknown>;
        }) => {
          if (method === "personal_sign") {
            expect(params).toEqual(["Hello World", "0x1234567890123456789012345678901234567890"]);
            return Promise.resolve("0xsignature");
          }
          return Promise.resolve();
        },
      });

      const result = yield* signMessage(provider, {
        account: "0x1234567890123456789012345678901234567890" as Address,
        message: "Hello World",
      });

      expect(result).toBe("0xsignature");
    })
  );

  it.effect("resolves account from eth_accounts when not provided", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[] | Record<string, unknown>;
        }) => {
          if (method === "eth_accounts") {
            return Promise.resolve(["0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"] as Address[]);
          }
          if (method === "personal_sign") {
            expect(params).toEqual(["Hello", "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"]);
            return Promise.resolve("0xsig");
          }
          return Promise.resolve();
        },
      });

      const result = yield* signMessage(provider, { message: "Hello" });
      expect(result).toBe("0xsig");
    })
  );

  it.effect("fails with AccountNotConnectedError when eth_accounts returns empty array", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({ method }: { method: string; params?: unknown[] | Record<string, unknown> }) => {
          if (method === "eth_accounts") {
            return Promise.resolve([] as Address[]);
          }
          return Promise.resolve();
        },
      });

      const exit = yield* Effect.exit(signMessage(provider, { message: "Hello" }));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        if (error._tag === "Some") {
          expect(error.value._tag).toBe("AccountNotConnectedError");
        }
      }
    })
  );

  it.effect("detects user rejection and returns SignMessageError with appropriate message", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({ method }: { method: string; params?: unknown[] | Record<string, unknown> }) => {
          if (method === "eth_accounts") {
            return Promise.resolve(["0x1234567890123456789012345678901234567890"] as Address[]);
          }
          if (method === "personal_sign") {
            return Promise.reject(new Error("User rejected the request"));
          }
          return Promise.resolve();
        },
      });

      const exit = yield* Effect.exit(signMessage(provider, { message: "Hello" }));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        if (error._tag === "Some") {
          expect(error.value._tag).toBe("SignMessageError");
          expect(error.value.message).toBe("User rejected the request");
        }
      }
    })
  );

  it.effect("returns Hex result on success", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({ method }: { method: string; params?: unknown[] | Record<string, unknown> }) => {
          if (method === "personal_sign") {
            return Promise.resolve("0x1234567890abcdef");
          }
          return Promise.resolve();
        },
      });

      const result = yield* signMessage(provider, {
        account: "0x1234567890123456789012345678901234567890" as Address,
        message: "Test",
      });

      expect(result).toBe("0x1234567890abcdef");
    })
  );

  it.effect("handles raw message format", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[] | Record<string, unknown>;
        }) => {
          if (method === "personal_sign") {
            expect((params as unknown[])?.[0]).toBe("0xabcd");
            return Promise.resolve("0xsig");
          }
          return Promise.resolve();
        },
      });

      const result = yield* signMessage(provider, {
        account: "0x1234567890123456789012345678901234567890" as Address,
        message: { raw: "0xabcd" },
      });

      expect(result).toBe("0xsig");
    })
  );
});

describe("signTypedData", () => {
  it.effect("uses provided account parameter", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[] | Record<string, unknown>;
        }) => {
          if (method === "eth_signTypedData_v4") {
            expect((params as unknown[])?.[0]).toBe("0x1234567890123456789012345678901234567890");
            return Promise.resolve("0xsignature");
          }
          return Promise.resolve();
        },
      });

      const result = yield* signTypedData(provider, {
        account: "0x1234567890123456789012345678901234567890" as Address,
        domain: {
          chainId: mainnet.id,
          name: "Test",
        },
        message: { test: "value" },
        primaryType: "Test",
        types: {
          Test: [{ name: "test", type: "string" }],
        },
      });

      expect(result).toBe("0xsignature");
    })
  );

  it.effect("resolves account from eth_accounts when not provided", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[] | Record<string, unknown>;
        }) => {
          if (method === "eth_accounts") {
            return Promise.resolve(["0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"] as Address[]);
          }
          if (method === "eth_signTypedData_v4") {
            expect((params as unknown[])?.[0]).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
            return Promise.resolve("0xsig");
          }
          return Promise.resolve();
        },
      });

      const result = yield* signTypedData(provider, {
        domain: { chainId: mainnet.id, name: "Test" },
        message: { test: "value" },
        primaryType: "Test",
        types: {
          Test: [{ name: "test", type: "string" }],
        },
      });

      expect(result).toBe("0xsig");
    })
  );

  it.effect("serializes payload correctly to JSON", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[] | Record<string, unknown>;
        }) => {
          if (method === "eth_signTypedData_v4") {
            const payload = JSON.parse((params as unknown[])?.[1] as string);
            expect(payload).toEqual({
              domain: { chainId: mainnet.id, name: "Test" },
              message: { test: "value" },
              primaryType: "Test",
              types: {
                Test: [{ name: "test", type: "string" }],
              },
            });
            return Promise.resolve("0xsig");
          }
          return Promise.resolve();
        },
      });

      const result = yield* signTypedData(provider, {
        account: "0x1234567890123456789012345678901234567890" as Address,
        domain: { chainId: mainnet.id, name: "Test" },
        message: { test: "value" },
        primaryType: "Test",
        types: {
          Test: [{ name: "test", type: "string" }],
        },
      });

      expect(result).toBe("0xsig");
    })
  );

  it.effect("detects user rejection", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({ method }: { method: string; params?: unknown[] | Record<string, unknown> }) => {
          if (method === "eth_accounts") {
            return Promise.resolve(["0x1234567890123456789012345678901234567890"] as Address[]);
          }
          if (method === "eth_signTypedData_v4") {
            return Promise.reject(new Error("User rejected the request"));
          }
          return Promise.resolve();
        },
      });

      const exit = yield* Effect.exit(
        signTypedData(provider, {
          domain: { chainId: mainnet.id, name: "Test" },
          message: { test: "value" },
          primaryType: "Test",
          types: {
            Test: [{ name: "test", type: "string" }],
          },
        })
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        if (error._tag === "Some") {
          expect(error.value._tag).toBe("SignTypedDataError");
          expect(error.value.message).toBe("User rejected the request");
        }
      }
    })
  );
});

describe("signTransaction", () => {
  it.effect("uses from parameter as account", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[] | Record<string, unknown>;
        }) => {
          if (method === "eth_signTransaction") {
            const tx = (params as [{ from: Address; to: Address; value: bigint }])[0];
            expect(tx.from).toBe("0x1234567890123456789012345678901234567890");
            return Promise.resolve("0xsignedtx");
          }
          return Promise.resolve();
        },
      });

      const result = yield* signTransaction(provider, {
        from: "0x1234567890123456789012345678901234567890" as Address,
        to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
        value: 1000000000000000000n,
      });

      expect(result).toBe("0xsignedtx");
    })
  );

  it.effect("resolves account from eth_accounts when from not provided", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[] | Record<string, unknown>;
        }) => {
          if (method === "eth_accounts") {
            return Promise.resolve(["0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"] as Address[]);
          }
          if (method === "eth_signTransaction") {
            const tx = (params as [{ from: Address }])[0];
            expect(tx.from).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
            return Promise.resolve("0xsig");
          }
          return Promise.resolve();
        },
      });

      const result = yield* signTransaction(provider, {
        to: "0x1234567890123456789012345678901234567890" as Address,
      });

      expect(result).toBe("0xsig");
    })
  );

  it.effect("merges from parameter correctly into transaction", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[] | Record<string, unknown>;
        }) => {
          if (method === "eth_signTransaction") {
            const tx = (params as [{ from: Address; to: Address; value: bigint; data: string }])[0];
            expect(tx).toEqual({
              data: "0xabcd",
              from: "0x1234567890123456789012345678901234567890",
              to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
              value: 1000n,
            });
            return Promise.resolve("0xsig");
          }
          return Promise.resolve();
        },
      });

      const result = yield* signTransaction(provider, {
        data: "0xabcd",
        from: "0x1234567890123456789012345678901234567890" as Address,
        to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
        value: 1000n,
      });

      expect(result).toBe("0xsig");
    })
  );

  it.effect("detects user rejection", () =>
    Effect.gen(function* () {
      const provider = makeMockWalletProvider({
        request: ({ method }: { method: string; params?: unknown[] | Record<string, unknown> }) => {
          if (method === "eth_accounts") {
            return Promise.resolve(["0x1234567890123456789012345678901234567890"] as Address[]);
          }
          if (method === "eth_signTransaction") {
            return Promise.reject(new Error("User denied transaction signature"));
          }
          return Promise.resolve();
        },
      });

      const exit = yield* Effect.exit(
        signTransaction(provider, {
          to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
        })
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        if (error._tag === "Some") {
          expect(error.value._tag).toBe("SignTxError");
          expect(error.value.message).toBe("User rejected the request");
        }
      }
    })
  );
});
