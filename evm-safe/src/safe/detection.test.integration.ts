import { describe, expect, it } from "@effect/vitest";
import { makePublicClientLayer, routemeshWithFallback } from "@prb/effect-evm/presets";
import { Effect } from "effect";
import type { Address } from "viem";
import { mainnet } from "viem/chains";
import { isSafeMultisig } from "./detection.js";

// Known Safe singleton hashes for verification
const SAFE_V1_3_0_SINGLETON = "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552" as Address;
const SAFE_V1_4_1_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a" as Address;

const PUBLIC_RPCS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://eth.llamarpc.com",
] as const;

// RouteMesh primary when the key is available, public RPCs as fallback. Treat as absent:
// empty string (GitHub Actions injects "" for missing secrets) and the undecrypted
// "encrypted:" literal that dotenvx injects when `.env.keys` is unavailable.
const routemeshApiKey = process.env.ROUTEMESH_API_KEY;
const rpcUrls =
  routemeshApiKey && !routemeshApiKey.startsWith("encrypted:")
    ? routemeshWithFallback(mainnet.id, routemeshApiKey, PUBLIC_RPCS)
    : [...PUBLIC_RPCS];

// Test layer with Ethereum mainnet RPCs behind viem's `fallback` transport so a
// single provider outage does not fail the suite.
const testLayer = makePublicClientLayer([
  {
    chain: mainnet,
    chainId: 1,
    rpcUrls,
  },
]);

describe("isSafeMultisig", () => {
  describe("Positive Cases - Known Safe Wallets", () => {
    it.effect("detects CoW DAO Safe (v1.3.0)", () =>
      Effect.gen(function* () {
        const result = yield* isSafeMultisig({
          address: "0xcA771eda0c70aA7d053aB1B25004559B918FE662",
          chainId: 1,
        });

        expect(result.isSafe).toBe(true);
        expect(result.proxyHash).toBeDefined();
        expect(result.singletonAddress).toBe(SAFE_V1_3_0_SINGLETON);
        expect(result.singletonHash).toBeDefined();
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("detects Gnosis DAO Safe (v1.3.0)", () =>
      Effect.gen(function* () {
        const result = yield* isSafeMultisig({
          address: "0x849D52316331967b6fF1198e5E32A0eB168D039d",
          chainId: 1,
        });

        expect(result.isSafe).toBe(true);
        expect(result.proxyHash).toBeDefined();
        expect(result.singletonAddress).toBe(SAFE_V1_3_0_SINGLETON);
        expect(result.singletonHash).toBeDefined();
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("detects v1.4.1 Safe", () =>
      Effect.gen(function* () {
        const result = yield* isSafeMultisig({
          address: "0x843ed9137c60772b30a71a7fbdb7f302f336ace7",
          chainId: 1,
        });

        expect(result.isSafe).toBe(true);
        expect(result.proxyHash).toBeDefined();
        expect(result.singletonAddress).toBe(SAFE_V1_4_1_SINGLETON);
        expect(result.singletonHash).toBeDefined();
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("Negative Cases - Non-Safe Contracts", () => {
    it.effect("identifies non-Safe contract (vitalik.eth with EIP-7702) as non-Safe", () =>
      Effect.gen(function* () {
        const result = yield* isSafeMultisig({
          address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
          chainId: 1,
        });

        // vitalik.eth address has bytecode (EIP-7702 delegation) but is not a Safe multisig
        expect(result.isSafe).toBe(false);
        expect(result.singletonAddress).toBeUndefined();
        expect(result.singletonHash).toBeUndefined();
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("identifies Uniswap V2 Router as non-Safe", () =>
      Effect.gen(function* () {
        const result = yield* isSafeMultisig({
          address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
          chainId: 1,
        });

        expect(result.isSafe).toBe(false);
        expect(result.proxyHash).toBeDefined();
        expect(result.singletonAddress).toBeUndefined();
        expect(result.singletonHash).toBeUndefined();
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("identifies USDC as non-Safe", () =>
      Effect.gen(function* () {
        const result = yield* isSafeMultisig({
          address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          chainId: 1,
        });

        expect(result.isSafe).toBe(false);
        expect(result.proxyHash).toBeDefined();
        expect(result.singletonAddress).toBeUndefined();
        expect(result.singletonHash).toBeUndefined();
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("Edge Cases", () => {
    it.effect("handles precompile address gracefully", () =>
      Effect.gen(function* () {
        const result = yield* isSafeMultisig({
          address: "0x0000000000000000000000000000000000000001",
          chainId: 1,
        });

        expect(result.isSafe).toBe(false);
        expect(result.proxyHash).toBeUndefined();
        expect(result.singletonAddress).toBeUndefined();
        expect(result.singletonHash).toBeUndefined();
      }).pipe(Effect.provide(testLayer))
    );
  });
});
