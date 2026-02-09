import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import { erc20Abi } from "viem";
import { ContractReader, ContractReaderLive } from "#src/contract/index.js";
import {
  makeMockPublicClientLayer,
  TEST_ADDRESS,
  TEST_CHAIN_ID,
  UNKNOWN_CHAIN_ID,
} from "#src/testing-kit/index.js";

describe("ContractReader", () => {
  describe("read", () => {
    it.effect("successfully reads contract value (balanceOf)", () =>
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
          Layer.provide(
            ContractReaderLive,
            makeMockPublicClientLayer({
              readContract: () => Promise.resolve(1000n),
            })
          )
        )
      )
    );

    it.effect("returns ContractReadError when viem readContract throws", () =>
      Effect.gen(function* () {
        const reader = yield* ContractReader;
        const exit = yield* reader
          .read({
            abi: erc20Abi,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS],
            chainId: TEST_CHAIN_ID,
            functionName: "balanceOf",
          })
          .pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractReaderLive,
            makeMockPublicClientLayer({
              readContract: () => Promise.reject(new Error("Contract execution reverted")),
            })
          )
        )
      )
    );

    it.effect("returns ClientNotFoundError for unknown chainId", () =>
      Effect.gen(function* () {
        const reader = yield* ContractReader;
        const exit = yield* reader
          .read({
            abi: erc20Abi,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS],
            chainId: UNKNOWN_CHAIN_ID,
            functionName: "balanceOf",
          })
          .pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = exit.cause;
          expect(error._tag).toBe("Fail");
        }
      }).pipe(Effect.provide(Layer.provide(ContractReaderLive, makeMockPublicClientLayer())))
    );
  });

  describe("multicall", () => {
    it.effect("returns array of success results", () =>
      Effect.gen(function* () {
        const reader = yield* ContractReader;
        const results = yield* reader.multicall(TEST_CHAIN_ID, [
          {
            abi: erc20Abi,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS],
            functionName: "balanceOf",
          },
          {
            abi: erc20Abi,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS],
            functionName: "balanceOf",
          },
        ]);

        expect(results).toHaveLength(2);
        expect(results[0].status).toBe("success");
        expect(results[1].status).toBe("success");
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractReaderLive,
            makeMockPublicClientLayer({
              multicall: () =>
                Promise.resolve([
                  { result: 100n, status: "success" },
                  { result: 200n, status: "success" },
                ]),
            })
          )
        )
      )
    );

    it.effect("handles partial failures (some success, some failure)", () =>
      Effect.gen(function* () {
        const reader = yield* ContractReader;
        const results = yield* reader.multicall(TEST_CHAIN_ID, [
          {
            abi: erc20Abi,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS],
            functionName: "balanceOf",
          },
          {
            abi: erc20Abi,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS],
            functionName: "balanceOf",
          },
        ]);

        expect(results).toHaveLength(2);
        expect(results[0].status).toBe("success");
        expect(results[1].status).toBe("failure");
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractReaderLive,
            makeMockPublicClientLayer({
              multicall: () =>
                Promise.resolve([
                  { result: 100n, status: "success" },
                  { error: new Error("Revert"), status: "failure" },
                ]),
            })
          )
        )
      )
    );

    it.effect("returns MulticallError when entire multicall fails", () =>
      Effect.gen(function* () {
        const reader = yield* ContractReader;
        const exit = yield* reader
          .multicall(TEST_CHAIN_ID, [
            {
              abi: erc20Abi,
              address: TEST_ADDRESS,
              args: [TEST_ADDRESS],
              functionName: "balanceOf",
            },
          ])
          .pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractReaderLive,
            makeMockPublicClientLayer({
              multicall: () => Promise.reject(new Error("RPC error")),
            })
          )
        )
      )
    );
  });
});
