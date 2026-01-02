import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import type { Address, Hash } from "viem";
import { erc20Abi } from "viem";
import { BalanceService } from "@/src/balance/index.js";
import { BlockService } from "@/src/block/index.js";
import { ContractReader } from "@/src/contract/index.js";
import { EnsResolver } from "@/src/ens/index.js";
import { GasService } from "@/src/gas/index.js";
import { NonceService } from "@/src/nonce/index.js";
import { SignatureService } from "@/src/signature/index.js";
import {
  makeEffectWeb3TestLayer,
  makeMockPublicClientLayer,
  makeMockWalletClientLayer,
  TEST_ADDRESS,
  TEST_CHAIN_ID,
  UNKNOWN_CHAIN_ID,
} from "@/src/testing-kit/index.js";

describe("Testing Kit", () => {
  describe("makeMockPublicClientLayer", () => {
    it("creates a layer with sensible defaults", () => {
      const layer = makeMockPublicClientLayer();
      expect(layer).toBeDefined();
    });

    it.effect("allows overriding specific methods", () =>
      Effect.gen(function* () {
        const reader = yield* ContractReader;
        const result = yield* reader.read({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS],
          chainId: TEST_CHAIN_ID,
          functionName: "balanceOf",
        });

        expect(result).toBe(42n);
      }).pipe(
        Effect.provide(
          makeEffectWeb3TestLayer({
            publicClient: {
              readContract: async () => 42n,
            },
          })
        )
      )
    );

    it.effect("supports custom chainId", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        // Should fail because we configured chainId 99999 but ENS uses mainnet (1)
        const exit = yield* resolver.getAddress("test.eth").pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          makeEffectWeb3TestLayer({
            chainId: UNKNOWN_CHAIN_ID,
          })
        )
      )
    );
  });

  describe("makeMockWalletClientLayer", () => {
    it("provides mock wallet client with defaults", () => {
      const layer = makeMockWalletClientLayer();
      expect(layer).toBeDefined();
    });

    it("allows custom account address", () => {
      const customAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
      const layer = makeMockWalletClientLayer({
        accountAddress: customAddress as Address,
      });
      expect(layer).toBeDefined();
    });
  });

  describe("makeEffectWeb3TestLayer", () => {
    it.effect("provides all services with mocked boundaries", () =>
      Effect.gen(function* () {
        const balance = yield* BalanceService;
        const block = yield* BlockService;
        const reader = yield* ContractReader;
        const resolver = yield* EnsResolver;
        const gas = yield* GasService;
        const nonce = yield* NonceService;
        const signature = yield* SignatureService;

        // Both should be available
        expect(balance).toBeDefined();
        expect(block).toBeDefined();
        expect(reader).toBeDefined();
        expect(resolver).toBeDefined();
        expect(gas).toBeDefined();
        expect(nonce).toBeDefined();
        expect(signature).toBeDefined();
      }).pipe(Effect.provide(makeEffectWeb3TestLayer()))
    );

    it.effect("allows reading contracts with custom mock", () =>
      Effect.gen(function* () {
        const reader = yield* ContractReader;
        const result = yield* reader.read({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS],
          chainId: TEST_CHAIN_ID,
          functionName: "balanceOf",
        });

        expect(result).toBe(1000n);
      }).pipe(
        Effect.provide(
          makeEffectWeb3TestLayer({
            publicClient: {
              readContract: async () => 1000n,
            },
          })
        )
      )
    );

    it.effect("allows ENS resolution with custom mock", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const result = yield* resolver.getAddress("custom.eth");

        expect(result).toBe("0xcustom");
      }).pipe(
        Effect.provide(
          makeEffectWeb3TestLayer({
            publicClient: {
              getEnsAddress: async () => "0xcustom" as Address,
            },
          })
        )
      )
    );

    it.effect("returns appropriate errors when mock returns null", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const exit = yield* resolver.getAddress("notfound.eth").pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          makeEffectWeb3TestLayer({
            publicClient: {
              getEnsAddress: async () => null,
            },
          })
        )
      )
    );

    it.effect("supports configuring both public and wallet client", () =>
      Effect.gen(function* () {
        const reader = yield* ContractReader;
        const result = yield* reader.read({
          abi: erc20Abi,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS],
          chainId: TEST_CHAIN_ID,
          functionName: "balanceOf",
        });

        expect(result).toBe(9999n);
      }).pipe(
        Effect.provide(
          makeEffectWeb3TestLayer({
            publicClient: {
              readContract: async () => 9999n,
            },
            walletClient: {
              writeContract: async () => "0xhash" as Hash,
            },
          })
        )
      )
    );

    it.effect("allows overriding a service implementation", () =>
      Effect.gen(function* () {
        const nonce = yield* NonceService;
        const reserved = yield* nonce.reserve({
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
        });

        expect(reserved).toBe(123n);
      }).pipe(
        Effect.provide(
          makeEffectWeb3TestLayer({
            nonceService: {
              reserve: () => Effect.succeed(123n),
            },
          })
        )
      )
    );

    it.effect("uses PublicClient mocks in Live services", () =>
      Effect.gen(function* () {
        const balanceService = yield* BalanceService;
        const balance = yield* balanceService.getBalance({
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
        });

        expect(balance).toBe(5n);
      }).pipe(
        Effect.provide(
          makeEffectWeb3TestLayer({
            publicClient: {
              getBalance: async () => 5n,
            },
          })
        )
      )
    );
  });
});
