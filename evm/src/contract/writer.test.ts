import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import { erc20Abi } from "viem";
import { ContractWriter, ContractWriterLive } from "#src/contract/index.js";
import { TransactionSubmissionError } from "#src/core/index.js";
import {
  makeMockPublicClientLayer,
  makeMockWalletClientLayer,
  TEST_ADDRESS,
  TEST_ADDRESS_2,
  TEST_CHAIN_ID,
  TEST_TX_HASH,
  UNKNOWN_CHAIN_ID,
} from "#src/testing-kit/index.js";

describe("ContractWriter", () => {
  describe("simulate", () => {
    it.effect("forwards tx overrides to viem simulateContract", () => {
      let captured: unknown;

      return Effect.gen(function* () {
        const writer = yield* ContractWriter;
        yield* writer.simulate({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          gas: 1n,
          overrides: {
            accessList: [{ address: TEST_ADDRESS, storageKeys: ["0x00"] }],
            gas: 2n,
            maxFeePerGas: 10n,
            maxPriorityFeePerGas: 1n,
            nonce: 7,
            type: "eip1559",
          },
        });

        expect(captured).toMatchObject({
          accessList: [{ address: TEST_ADDRESS, storageKeys: ["0x00"] }],
          gas: 2n,
          maxFeePerGas: 10n,
          maxPriorityFeePerGas: 1n,
          nonce: 7,
          type: "eip1559",
        });
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractWriterLive,
            Layer.merge(
              makeMockPublicClientLayer({
                simulateContract: (params: unknown) => {
                  captured = params;
                  return Promise.resolve({ request: params, result: true });
                },
              }),
              makeMockWalletClientLayer()
            )
          )
        )
      );
    });

    it.effect("returns simulation result on success", () =>
      Effect.gen(function* () {
        const writer = yield* ContractWriter;
        const result = yield* writer.simulate({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        expect(result.result).toBe(true);
        expect(result.request).toBeDefined();
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractWriterLive,
            Layer.merge(
              makeMockPublicClientLayer({
                simulateContract: (params: unknown) =>
                  Promise.resolve({
                    request: params,
                    result: true,
                  }),
              }),
              makeMockWalletClientLayer()
            )
          )
        )
      )
    );

    it.effect("returns SimulationFailedError on failure", () =>
      Effect.gen(function* () {
        const writer = yield* ContractWriter;
        const exit = yield* writer
          .simulate({
            abi: erc20Abi,
            account: TEST_ADDRESS,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS_2, 100n],
            chainId: TEST_CHAIN_ID,
            functionName: "transfer",
          })
          .pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractWriterLive,
            Layer.merge(
              makeMockPublicClientLayer({
                simulateContract: () => Promise.reject(new Error("Simulation failed")),
              }),
              makeMockWalletClientLayer()
            )
          )
        )
      )
    );
  });

  describe("estimateGas", () => {
    it.effect("forwards tx overrides to viem estimateContractGas", () => {
      let captured: unknown;

      return Effect.gen(function* () {
        const writer = yield* ContractWriter;
        yield* writer.estimateGas({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          overrides: {
            gasPrice: 123n,
            nonce: 42,
            type: "legacy",
          },
        });

        expect(captured).toMatchObject({
          gasPrice: 123n,
          nonce: 42,
          type: "legacy",
        });
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractWriterLive,
            Layer.merge(
              makeMockPublicClientLayer({
                estimateContractGas: (params: unknown) => {
                  captured = params;
                  return Promise.resolve(50000n);
                },
              }),
              makeMockWalletClientLayer()
            )
          )
        )
      );
    });

    it.effect("returns gas estimate bigint", () =>
      Effect.gen(function* () {
        const writer = yield* ContractWriter;
        const gas = yield* writer.estimateGas({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        expect(gas).toBe(50000n);
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractWriterLive,
            Layer.merge(
              makeMockPublicClientLayer({
                estimateContractGas: () => Promise.resolve(50000n),
              }),
              makeMockWalletClientLayer()
            )
          )
        )
      )
    );

    it.effect("returns GasEstimationError on failure", () =>
      Effect.gen(function* () {
        const writer = yield* ContractWriter;
        const exit = yield* writer
          .estimateGas({
            abi: erc20Abi,
            account: TEST_ADDRESS,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS_2, 100n],
            chainId: TEST_CHAIN_ID,
            functionName: "transfer",
          })
          .pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractWriterLive,
            Layer.merge(
              makeMockPublicClientLayer({
                estimateContractGas: () => Promise.reject(new Error("Gas estimation failed")),
              }),
              makeMockWalletClientLayer()
            )
          )
        )
      )
    );
  });

  describe("write", () => {
    it.effect("forwards tx overrides to viem writeContract", () => {
      let captured: unknown;

      return Effect.gen(function* () {
        const writer = yield* ContractWriter;
        yield* writer.write({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          overrides: {
            gasPrice: 123n,
            nonce: 42,
            type: "legacy",
          },
        });

        expect(captured).toMatchObject({
          gasPrice: 123n,
          nonce: 42,
          type: "legacy",
        });
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractWriterLive,
            Layer.merge(
              makeMockPublicClientLayer(),
              makeMockWalletClientLayer({
                writeContract: (params: unknown) => {
                  captured = params;
                  return Promise.resolve(TEST_TX_HASH);
                },
              })
            )
          )
        )
      );
    });

    it.effect("returns transaction hash on success", () =>
      Effect.gen(function* () {
        const writer = yield* ContractWriter;
        const hash = yield* writer.write({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        expect(hash).toBe(TEST_TX_HASH);
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractWriterLive,
            Layer.merge(
              makeMockPublicClientLayer(),
              makeMockWalletClientLayer({
                writeContract: () => Promise.resolve(TEST_TX_HASH),
              })
            )
          )
        )
      )
    );

    it.effect("returns ContractWriteError on failure", () =>
      Effect.gen(function* () {
        const writer = yield* ContractWriter;
        const result = yield* writer
          .write({
            abi: erc20Abi,
            account: TEST_ADDRESS,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS_2, 100n],
            chainId: TEST_CHAIN_ID,
            functionName: "transfer",
          })
          .pipe(Effect.result);

        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.failure._tag).toBe("ContractWriteError");
        }
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractWriterLive,
            Layer.merge(
              makeMockPublicClientLayer(),
              makeMockWalletClientLayer({
                writeContract: () => Promise.reject(new Error("Write failed")),
              })
            )
          )
        )
      )
    );

    it.effect("returns TransactionSubmissionError for raw transaction decoding failures", () => {
      const providerError = new Error(
        "RPC 0x8f Custom eth_sendRawTransaction: Transaction decoding error"
      );

      return Effect.gen(function* () {
        const writer = yield* ContractWriter;
        const result = yield* writer
          .write({
            abi: erc20Abi,
            account: TEST_ADDRESS,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS_2, 100n],
            chainId: TEST_CHAIN_ID,
            functionName: "transfer",
          })
          .pipe(Effect.result);

        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.failure).toBeInstanceOf(TransactionSubmissionError);
          if (result.failure._tag === "TransactionSubmissionError") {
            expect(result.failure.cause).toBe(providerError);
          }
        }
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractWriterLive,
            Layer.merge(
              makeMockPublicClientLayer(),
              makeMockWalletClientLayer({
                writeContract: () => Promise.reject(providerError),
              })
            )
          )
        )
      );
    });

    it.effect("returns WalletNotConnectedError for unknown chainId", () =>
      Effect.gen(function* () {
        const writer = yield* ContractWriter;
        const exit = yield* writer
          .write({
            abi: erc20Abi,
            account: TEST_ADDRESS,
            address: TEST_ADDRESS,
            args: [TEST_ADDRESS_2, 100n],
            chainId: UNKNOWN_CHAIN_ID,
            functionName: "transfer",
          })
          .pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            ContractWriterLive,
            Layer.merge(makeMockPublicClientLayer(), makeMockWalletClientLayer())
          )
        )
      )
    );
  });
});
