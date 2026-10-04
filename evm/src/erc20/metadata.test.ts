import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { stringToHex } from "viem";
import { erc20Abi, erc20Abi_bytes32 } from "#src/abi/index.js";
import type { ContractReaderShape } from "#src/contract/index.js";
import { ContractReader } from "#src/contract/index.js";
import { readErc20Metadata } from "#src/erc20/index.js";
import { TEST_ADDRESS, TEST_CHAIN_ID } from "#src/testing-kit/index.js";
import type { MulticallResult } from "#src/types/index.js";

type MulticallCall = Readonly<{
  abi: unknown;
  address: string;
  args?: readonly unknown[];
  functionName: string;
}>;

type MulticallRecord = Readonly<{
  chainId: number;
  calls: readonly MulticallCall[];
}>;

const makeReaderLayer = (records: MulticallRecord[], results: readonly MulticallResult[]) =>
  Layer.succeed(
    ContractReader,
    ContractReader.of({
      multicall: ((chainId: number, calls: readonly MulticallCall[]) => {
        records.push({ calls, chainId });
        return Effect.succeed(results);
      }) as unknown as ContractReaderShape["multicall"],
      read: (() => Effect.die(new Error("unused"))) as unknown as ContractReaderShape["read"],
    } satisfies ContractReaderShape)
  );

describe("ERC-20 Metadata", () => {
  it.effect("reads metadata with bytes32 fallback and default decimals", () =>
    (() => {
      const records: MulticallRecord[] = [];
      const results = [
        { error: new Error("no decimals"), status: "failure" },
        { error: new Error("no name"), status: "failure" },
        { error: new Error("no symbol"), status: "failure" },
        {
          result: stringToHex("Tether USD", { size: 32 }),
          status: "success",
        },
        {
          result: stringToHex("USDT", { size: 32 }),
          status: "success",
        },
      ] as const satisfies readonly MulticallResult[];

      return Effect.gen(function* () {
        const metadata = yield* readErc20Metadata({
          chainId: TEST_CHAIN_ID,
          tokenAddress: TEST_ADDRESS,
        });

        expect(metadata).toEqual({
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          decimals: 18,
          name: "Tether USD",
          symbol: "USDT",
        });

        expect(records).toHaveLength(1);
        const record = records[0];
        expect(record?.chainId).toBe(TEST_CHAIN_ID);
        expect(record?.calls.map((call) => call.functionName)).toEqual([
          "decimals",
          "name",
          "symbol",
          "name",
          "symbol",
        ]);
        expect(record?.calls[0]?.abi).toBe(erc20Abi);
        expect(record?.calls[3]?.abi).toBe(erc20Abi_bytes32);
        expect(record?.calls[0]?.address).toBe(TEST_ADDRESS);
      }).pipe(Effect.provide(makeReaderLayer(records, results)));
    })()
  );

  it.effect("prefers string results over bytes32", () =>
    (() => {
      const records: MulticallRecord[] = [];
      const results = [
        { result: 6, status: "success" },
        { result: "USD Coin", status: "success" },
        { result: "USDC", status: "success" },
        { result: stringToHex("Ignored", { size: 32 }), status: "success" },
        { result: stringToHex("NOPE", { size: 32 }), status: "success" },
      ] as const satisfies readonly MulticallResult[];

      return Effect.gen(function* () {
        const metadata = yield* readErc20Metadata({
          chainId: TEST_CHAIN_ID,
          tokenAddress: TEST_ADDRESS,
        });

        expect(metadata).toEqual({
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
          decimals: 6,
          name: "USD Coin",
          symbol: "USDC",
        });

        expect(records).toHaveLength(1);
      }).pipe(Effect.provide(makeReaderLayer(records, results)));
    })()
  );

  it.effect("accepts bigint decimals", () =>
    (() => {
      const records: MulticallRecord[] = [];
      const results = [
        { result: 6n, status: "success" },
        { result: "USD Coin", status: "success" },
        { result: "USDC", status: "success" },
        { result: stringToHex("Ignored", { size: 32 }), status: "success" },
        { result: stringToHex("NOPE", { size: 32 }), status: "success" },
      ] as const satisfies readonly MulticallResult[];

      return Effect.gen(function* () {
        const metadata = yield* readErc20Metadata({
          chainId: TEST_CHAIN_ID,
          tokenAddress: TEST_ADDRESS,
        });

        expect(metadata.decimals).toBe(6);
        expect(metadata.name).toBe("USD Coin");
        expect(metadata.symbol).toBe("USDC");
      }).pipe(Effect.provide(makeReaderLayer(records, results)));
    })()
  );

  it.effect("falls back to bytes32 when string result is empty", () =>
    (() => {
      const records: MulticallRecord[] = [];
      const results = [
        { result: 18, status: "success" },
        { result: "   ", status: "success" },
        { result: "", status: "success" },
        { result: stringToHex("Tether USD", { size: 32 }), status: "success" },
        { result: stringToHex("USDT", { size: 32 }), status: "success" },
      ] as const satisfies readonly MulticallResult[];

      return Effect.gen(function* () {
        const metadata = yield* readErc20Metadata({
          chainId: TEST_CHAIN_ID,
          tokenAddress: TEST_ADDRESS,
        });

        expect(metadata.name).toBe("Tether USD");
        expect(metadata.symbol).toBe("USDT");
      }).pipe(Effect.provide(makeReaderLayer(records, results)));
    })()
  );
});
