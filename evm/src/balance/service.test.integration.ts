import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import type { Address, Hex } from "viem";
import { mainnet } from "viem/chains";
import { BalanceService, decodeBytes32String } from "#src/balance/index.js";
import { ClientNotFoundError, TransportError } from "#src/core/index.js";
import { makeEffectEvmTestLayer } from "#src/testing-kit/index.js";

describe("BalanceService (Live)", () => {
  const testAddress = "0x1234567890123456789012345678901234567890" as Address;
  const tokenAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;

  const testLayer = makeEffectEvmTestLayer({
    publicClient: {
      getBalance: () => Promise.resolve(1000000000000000000n),
      multicall: (params: unknown) => {
        const contracts =
          (params as { contracts?: Array<{ functionName?: string }> }).contracts ?? [];
        return Promise.resolve(
          contracts.map((c) => {
            switch (c.functionName) {
              case "balanceOf":
                return { result: 1000000000n, status: "success" as const };
              case "decimals":
                return { result: 18, status: "success" as const };
              case "symbol":
                return { result: "MOCK", status: "success" as const };
              case "name":
                return { result: "Mock Token", status: "success" as const };
              default:
                return { result: 0n, status: "success" as const };
            }
          })
        );
      },
      readContract: (params: unknown) => {
        const functionName = (params as { functionName?: string }).functionName;
        if (functionName === "balanceOf") {
          return Promise.resolve(1000000000n);
        }
        return Promise.resolve(0n);
      },
    },
  });

  describe("getBalance", () => {
    it.effect("returns native balance", () =>
      Effect.gen(function* () {
        const service = yield* BalanceService;
        const result = yield* service.getBalance({
          address: testAddress,
          chainId: mainnet.id,
        });

        expect(result).toBe(1000000000000000000n);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("supports blockTag parameter", () =>
      Effect.gen(function* () {
        const service = yield* BalanceService;
        const result = yield* service.getBalance({
          address: testAddress,
          blockTag: "latest",
          chainId: mainnet.id,
        });

        expect(result).toBe(1000000000000000000n);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("fails with TransportError (not defect) when RPC rejects", () => {
      const failingLayer = makeEffectEvmTestLayer({
        publicClient: {
          getBalance: () => Promise.reject(new Error("boom")),
        },
      });

      return Effect.gen(function* () {
        const service = yield* BalanceService;
        const exit = yield* Effect.exit(
          service.getBalance({
            address: testAddress,
            chainId: mainnet.id,
          })
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          expect(error._tag).toBe("Some");
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(TransportError);
          }
        }
      }).pipe(Effect.provide(failingLayer));
    });

    it.effect("fails with ClientNotFoundError for unsupported chainId", () =>
      Effect.gen(function* () {
        const service = yield* BalanceService;
        const exit = yield* Effect.exit(
          service.getBalance({
            address: testAddress,
            chainId: 123_456_789,
          })
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(ClientNotFoundError);
          }
        }
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("getTokenBalance", () => {
    it.effect("returns token balance", () =>
      Effect.gen(function* () {
        const service = yield* BalanceService;
        const result = yield* service.getTokenBalance({
          address: testAddress,
          chainId: mainnet.id,
          tokenAddress,
        });

        expect(result).toBe(1000000000n);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("getTokenBalances", () => {
    it.effect("returns multiple token balances with metadata", () =>
      Effect.gen(function* () {
        const service = yield* BalanceService;
        const tokenAddresses = [
          "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
          "0x1111111111111111111111111111111111111111" as Address,
        ];

        const result = yield* service.getTokenBalances({
          address: testAddress,
          chainId: mainnet.id,
          tokenAddresses,
        });

        expect(result).toHaveLength(2);
        expect(result[0]?.balance).toBe(1000000000n);
        expect(result[0]?.decimals).toBe(18);
        expect(result[0]?.symbol).toBe("MOCK");
        expect(result[0]?.name).toBe("Mock Token");
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("falls back to bytes32 when string calls fail", () => {
      type AbiItem = { name?: string; outputs?: Array<{ type?: string }> };
      type ContractCall = { functionName?: string; abi?: AbiItem[] };
      type MulticallParams = { contracts?: ContractCall[] };

      // Simulate token that uses bytes32 for symbol/name
      const bytes32Layer = makeEffectEvmTestLayer({
        publicClient: {
          multicall: (params: unknown) => {
            const contracts = (params as MulticallParams).contracts ?? [];
            return Promise.resolve(
              contracts.map((c) => {
                // Detect bytes32 ABI by checking if it returns bytes32
                const isBytes32Abi =
                  Array.isArray(c.abi) &&
                  c.abi.some(
                    (item) => item.name === c.functionName && item.outputs?.[0]?.type === "bytes32"
                  );

                switch (c.functionName) {
                  case "balanceOf":
                    return { result: 1000000000n, status: "success" as const };
                  case "decimals":
                    return { result: 18, status: "success" as const };
                  case "symbol":
                    if (isBytes32Abi) {
                      // Return USDT in bytes32 format
                      return {
                        result:
                          "0x5553445400000000000000000000000000000000000000000000000000000000" as Hex,
                        status: "success" as const,
                      };
                    }
                    // String version fails
                    return {
                      error: new Error("not supported"),
                      status: "failure" as const,
                    };
                  case "name":
                    if (isBytes32Abi) {
                      // Return "Tether USD" in bytes32 format
                      return {
                        result:
                          "0x5465746865722055534400000000000000000000000000000000000000000000" as Hex,
                        status: "success" as const,
                      };
                    }
                    // String version fails
                    return {
                      error: new Error("not supported"),
                      status: "failure" as const,
                    };
                  default:
                    return { result: 0n, status: "success" as const };
                }
              })
            );
          },
        },
      });

      return Effect.gen(function* () {
        const service = yield* BalanceService;
        const result = yield* service.getTokenBalances({
          address: testAddress,
          chainId: mainnet.id,
          tokenAddresses: [tokenAddress],
        });

        expect(result).toHaveLength(1);
        expect(result[0]?.symbol).toBe("USDT");
        expect(result[0]?.name).toBe("Tether USD");
      }).pipe(Effect.provide(bytes32Layer));
    });

    it.effect("prefers string results over bytes32 when both succeed", () => {
      type AbiItem = { name?: string; outputs?: Array<{ type?: string }> };
      type ContractCall = { functionName?: string; abi?: AbiItem[] };
      type MulticallParams = { contracts?: ContractCall[] };

      // Simulate token that supports both string and bytes32
      const hybridLayer = makeEffectEvmTestLayer({
        publicClient: {
          multicall: (params: unknown) => {
            const contracts = (params as MulticallParams).contracts ?? [];
            return Promise.resolve(
              contracts.map((c) => {
                const isBytes32Abi =
                  Array.isArray(c.abi) &&
                  c.abi.some(
                    (item) => item.name === c.functionName && item.outputs?.[0]?.type === "bytes32"
                  );

                switch (c.functionName) {
                  case "balanceOf":
                    return { result: 1000000000n, status: "success" as const };
                  case "decimals":
                    return { result: 18, status: "success" as const };
                  case "symbol":
                    if (isBytes32Abi) {
                      return {
                        result:
                          "0x4d4f434b00000000000000000000000000000000000000000000000000000000" as Hex,
                        status: "success" as const,
                      };
                    }
                    return {
                      result: "MOCK_STRING",
                      status: "success" as const,
                    };
                  case "name":
                    if (isBytes32Abi) {
                      return {
                        result:
                          "0x4d6f636b20546f6b656e0000000000000000000000000000000000000000000000" as Hex,
                        status: "success" as const,
                      };
                    }
                    return {
                      result: "Mock Token String",
                      status: "success" as const,
                    };
                  default:
                    return { result: 0n, status: "success" as const };
                }
              })
            );
          },
        },
      });

      return Effect.gen(function* () {
        const service = yield* BalanceService;
        const result = yield* service.getTokenBalances({
          address: testAddress,
          chainId: mainnet.id,
          tokenAddresses: [tokenAddress],
        });

        expect(result).toHaveLength(1);
        // Should prefer string results
        expect(result[0]?.symbol).toBe("MOCK_STRING");
        expect(result[0]?.name).toBe("Mock Token String");
      }).pipe(Effect.provide(hybridLayer));
    });
  });

  describe("hasSufficientBalance", () => {
    it.effect("returns true/false based on native balance", () =>
      Effect.gen(function* () {
        const service = yield* BalanceService;
        const ok = yield* service.hasSufficientBalance({
          address: testAddress,
          chainId: mainnet.id,
          required: 500000000000000000n,
        });
        const notOk = yield* service.hasSufficientBalance({
          address: testAddress,
          chainId: mainnet.id,
          required: 2000000000000000000n,
        });

        expect(ok).toBe(true);
        expect(notOk).toBe(false);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("hasSufficientTokenBalance", () => {
    it.effect("returns true/false based on token balance", () =>
      Effect.gen(function* () {
        const service = yield* BalanceService;
        const ok = yield* service.hasSufficientTokenBalance({
          address: testAddress,
          chainId: mainnet.id,
          required: 500000000n,
          tokenAddress,
        });
        const notOk = yield* service.hasSufficientTokenBalance({
          address: testAddress,
          chainId: mainnet.id,
          required: 2000000000n,
          tokenAddress,
        });

        expect(ok).toBe(true);
        expect(notOk).toBe(false);
      }).pipe(Effect.provide(testLayer))
    );
  });
});

describe("decodeBytes32String", () => {
  it("decodes bytes32 string correctly", () => {
    // "USDT" encoded as bytes32
    const usdt = "0x5553445400000000000000000000000000000000000000000000000000000000" as Hex;
    expect(decodeBytes32String(usdt)).toBe("USDT");

    // "Tether USD" encoded as bytes32
    const tetherUsd = "0x5465746865722055534400000000000000000000000000000000000000000000" as Hex;
    expect(decodeBytes32String(tetherUsd)).toBe("Tether USD");
  });

  it("returns undefined for empty or invalid input", () => {
    expect(decodeBytes32String("0x" as Hex)).toBeUndefined();
    expect(
      decodeBytes32String(
        "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex
      )
    ).toBeUndefined();
  });

  it("handles trailing null bytes", () => {
    // "DAI" with trailing nulls
    const dai = "0x4441490000000000000000000000000000000000000000000000000000000000" as Hex;
    expect(decodeBytes32String(dai)).toBe("DAI");
  });

  it("strips whitespace", () => {
    // "TEST " with space and nulls
    const testWithSpace =
      "0x5445535420000000000000000000000000000000000000000000000000000000" as Hex;
    expect(decodeBytes32String(testWithSpace)).toBe("TEST");
  });
});
