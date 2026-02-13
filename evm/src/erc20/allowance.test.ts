import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { erc20Abi, erc20NoOutputAbi } from "#src/abi/index.js";
import type { ContractReaderShape, ContractWriterShape } from "#src/contract/index.js";
import { ContractReader, ContractWriter } from "#src/contract/index.js";
import {
  ApprovalCheckError,
  ApprovalError,
  ContractReadError,
  SimulationFailedError,
} from "#src/core/index.js";
import {
  Erc20AllowanceService,
  Erc20AllowanceServiceLive,
  Erc20NoOutputAllowanceService,
  Erc20NoOutputAllowanceServiceLive,
} from "#src/erc20/index.js";
import {
  TEST_ADDRESS,
  TEST_ADDRESS_2,
  TEST_CHAIN_ID,
  TEST_TX_HASH,
} from "#src/testing-kit/index.js";

type Call = Readonly<{ kind: "read" | "simulate" | "write"; params: unknown }>;

const TEST_TX_HASH_2 =
  "0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef" as const;

const makeDepsLayer = (calls: Call[], readResult = 123n) =>
  Layer.mergeAll(
    Layer.succeed(
      ContractReader,
      ContractReader.of({
        multicall: (() =>
          Effect.dieMessage("unused")) as unknown as ContractReaderShape["multicall"],
        read: ((params: unknown) => {
          calls.push({ kind: "read", params });
          return Effect.succeed(readResult);
        }) as unknown as ContractReaderShape["read"],
      } satisfies ContractReaderShape)
    ),
    Layer.succeed(
      ContractWriter,
      ContractWriter.of({
        estimateGas: (() =>
          Effect.dieMessage("unused")) as unknown as ContractWriterShape["estimateGas"],
        simulate: ((params: unknown) => {
          calls.push({ kind: "simulate", params });
          return Effect.succeed({ request: {}, result: true });
        }) as unknown as ContractWriterShape["simulate"],
        write: ((params: unknown) => {
          calls.push({ kind: "write", params });
          return Effect.succeed(TEST_TX_HASH);
        }) as unknown as ContractWriterShape["write"],
      } satisfies ContractWriterShape)
    )
  );

describe("ERC-20 Allowance Services", () => {
  describe("Erc20AllowanceService", () => {
    it.effect("checkAllowance reads allowance(owner, spender) with erc20Abi", () =>
      (() => {
        const calls: Call[] = [];
        return Effect.gen(function* () {
          const service = yield* Erc20AllowanceService;

          const allowance = yield* service.checkAllowance({
            chainId: TEST_CHAIN_ID,
            owner: TEST_ADDRESS,
            spender: TEST_ADDRESS_2,
            tokenAddress: TEST_ADDRESS,
          });

          expect(allowance).toBe(123n);
          expect(calls.map((c) => c.kind)).toEqual(["read"]);

          const readParams = calls[0]?.params as {
            abi: unknown;
            address: string;
            args?: readonly unknown[];
            chainId: number;
            functionName: string;
          };
          expect(readParams.abi).toBe(erc20Abi);
          expect(readParams.address).toBe(TEST_ADDRESS);
          expect(readParams.chainId).toBe(TEST_CHAIN_ID);
          expect(readParams.functionName).toBe("allowance");
          expect(readParams.args).toEqual([TEST_ADDRESS, TEST_ADDRESS_2]);
        }).pipe(
          Effect.provide(Layer.provide(Erc20AllowanceServiceLive, makeDepsLayer(calls, 123n)))
        );
      })()
    );

    it.effect("approve simulates then writes approve(spender, amount) with erc20Abi", () =>
      (() => {
        const calls: Call[] = [];
        return Effect.gen(function* () {
          const service = yield* Erc20AllowanceService;

          const hash = yield* service.approve({
            account: TEST_ADDRESS,
            amount: 456n,
            chainId: TEST_CHAIN_ID,
            spender: TEST_ADDRESS_2,
            tokenAddress: TEST_ADDRESS,
          });

          expect(hash).toBe(TEST_TX_HASH);
          expect(calls.map((c) => c.kind)).toEqual(["simulate", "write"]);

          const simulateParams = calls[0]?.params as {
            abi: unknown;
            address: string;
            args?: readonly unknown[];
            chainId: number;
            functionName: string;
          };
          const writeParams = calls[1]?.params as unknown;

          expect(simulateParams).toBe(writeParams);
          expect(simulateParams.abi).toBe(erc20Abi);
          expect(simulateParams.address).toBe(TEST_ADDRESS);
          expect(simulateParams.chainId).toBe(TEST_CHAIN_ID);
          expect(simulateParams.functionName).toBe("approve");
          expect(simulateParams.args).toEqual([TEST_ADDRESS_2, 456n]);
        }).pipe(Effect.provide(Layer.provide(Erc20AllowanceServiceLive, makeDepsLayer(calls))));
      })()
    );

    it.effect("maps simulate failure to ApprovalError", () =>
      Effect.gen(function* () {
        const service = yield* Erc20AllowanceService;

        const result = yield* service
          .approve({
            account: TEST_ADDRESS,
            amount: 1n,
            chainId: TEST_CHAIN_ID,
            spender: TEST_ADDRESS_2,
            tokenAddress: TEST_ADDRESS,
          })
          .pipe(Effect.catchTag("ApprovalError", (e) => Effect.succeed(e)));

        if (typeof result === "string") {
          throw new Error("Expected ApprovalError, got success");
        }

        const error = result;
        expect(error).toBeInstanceOf(ApprovalError);
        expect(error._tag).toBe("ApprovalError");
        expect(error.spender).toBe(TEST_ADDRESS_2);
        expect(error.tokenAddress).toBe(TEST_ADDRESS);
      }).pipe(
        Effect.provide(
          Layer.provide(
            Erc20AllowanceServiceLive,
            Layer.mergeAll(
              Layer.succeed(
                ContractReader,
                ContractReader.of({
                  multicall: (() =>
                    Effect.dieMessage("unused")) as unknown as ContractReaderShape["multicall"],
                  read: (() =>
                    Effect.dieMessage("unused")) as unknown as ContractReaderShape["read"],
                } satisfies ContractReaderShape)
              ),
              Layer.succeed(
                ContractWriter,
                ContractWriter.of({
                  estimateGas: (() =>
                    Effect.dieMessage("unused")) as unknown as ContractWriterShape["estimateGas"],
                  simulate: (() =>
                    Effect.fail(
                      new SimulationFailedError({
                        address: TEST_ADDRESS,
                        functionName: "approve",
                        message: "revert",
                        phase: "simulate",
                      })
                    )) as unknown as ContractWriterShape["simulate"],
                  write: (() =>
                    Effect.dieMessage("unreachable")) as unknown as ContractWriterShape["write"],
                } satisfies ContractWriterShape)
              )
            )
          )
        )
      )
    );

    it.effect("maps read failure to ApprovalCheckError", () =>
      Effect.gen(function* () {
        const service = yield* Erc20AllowanceService;

        const result = yield* service
          .checkAllowance({
            chainId: TEST_CHAIN_ID,
            owner: TEST_ADDRESS,
            spender: TEST_ADDRESS_2,
            tokenAddress: TEST_ADDRESS,
          })
          .pipe(Effect.catchTag("ApprovalCheckError", (e) => Effect.succeed(e)));

        if (typeof result === "bigint") {
          throw new Error("Expected ApprovalCheckError, got success");
        }

        const error = result;
        expect(error).toBeInstanceOf(ApprovalCheckError);
        expect(error._tag).toBe("ApprovalCheckError");
        expect(error.owner).toBe(TEST_ADDRESS);
        expect(error.spender).toBe(TEST_ADDRESS_2);
        expect(error.tokenAddress).toBe(TEST_ADDRESS);
      }).pipe(
        Effect.provide(
          Layer.provide(
            Erc20AllowanceServiceLive,
            Layer.mergeAll(
              Layer.succeed(
                ContractReader,
                ContractReader.of({
                  multicall: (() =>
                    Effect.dieMessage("unused")) as unknown as ContractReaderShape["multicall"],
                  read: (() =>
                    Effect.fail(
                      new ContractReadError({
                        address: TEST_ADDRESS,
                        functionName: "allowance",
                        message: "rpc failed",
                      })
                    )) as unknown as ContractReaderShape["read"],
                } satisfies ContractReaderShape)
              ),
              Layer.succeed(
                ContractWriter,
                ContractWriter.of({
                  estimateGas: (() =>
                    Effect.dieMessage("unused")) as unknown as ContractWriterShape["estimateGas"],
                  simulate: (() =>
                    Effect.dieMessage("unused")) as unknown as ContractWriterShape["simulate"],
                  write: (() =>
                    Effect.dieMessage("unused")) as unknown as ContractWriterShape["write"],
                } satisfies ContractWriterShape)
              )
            )
          )
        )
      )
    );

    it.effect("getMaxAmount returns uint256.max", () =>
      (() => {
        const calls: Call[] = [];
        return Effect.gen(function* () {
          const service = yield* Erc20AllowanceService;
          expect(service.getMaxAmount(18)).toBe(2n ** 256n - 1n);
        }).pipe(Effect.provide(Layer.provide(Erc20AllowanceServiceLive, makeDepsLayer(calls))));
      })()
    );

    it.effect("ensureAllowance no-ops when current allowance is sufficient", () =>
      (() => {
        const calls: Call[] = [];
        return Effect.gen(function* () {
          const service = yield* Erc20AllowanceService;

          const result = yield* service.ensureAllowance({
            account: TEST_ADDRESS,
            chainId: TEST_CHAIN_ID,
            required: 10n,
            spender: TEST_ADDRESS_2,
            tokenAddress: TEST_ADDRESS,
          });

          expect(result.status).toBe("already-sufficient");
          expect(calls.map((c) => c.kind)).toEqual(["read"]);
        }).pipe(
          Effect.provide(Layer.provide(Erc20AllowanceServiceLive, makeDepsLayer(calls, 123n)))
        );
      })()
    );

    it.effect("ensureAllowance approves when current allowance is insufficient", () =>
      (() => {
        const calls: Call[] = [];
        return Effect.gen(function* () {
          const service = yield* Erc20AllowanceService;

          const result = yield* service.ensureAllowance({
            account: TEST_ADDRESS,
            chainId: TEST_CHAIN_ID,
            required: 200n,
            spender: TEST_ADDRESS_2,
            tokenAddress: TEST_ADDRESS,
          });

          expect(result.status).toBe("approved");
          if (result.status !== "approved") {
            throw new Error("Expected approved result");
          }

          expect(result.hashes).toEqual([TEST_TX_HASH]);
          expect(result.mode).toBe("direct");
          expect(calls.map((c) => c.kind)).toEqual(["read", "simulate", "write"]);
        }).pipe(Effect.provide(Layer.provide(Erc20AllowanceServiceLive, makeDepsLayer(calls, 0n))));
      })()
    );

    it.effect(
      "ensureAllowance falls back to approve(0) then approve(amount) when direct approve fails and allowance is non-zero",
      () =>
        (() => {
          const calls: Call[] = [];
          let nonZeroAttempt = 0;
          let writeAttempt = 0;

          const deps = Layer.mergeAll(
            Layer.succeed(
              ContractReader,
              ContractReader.of({
                multicall: (() =>
                  Effect.dieMessage("unused")) as unknown as ContractReaderShape["multicall"],
                read: ((params: unknown) => {
                  calls.push({ kind: "read", params });
                  return Effect.succeed(1n);
                }) as unknown as ContractReaderShape["read"],
              } satisfies ContractReaderShape)
            ),
            Layer.succeed(
              ContractWriter,
              ContractWriter.of({
                estimateGas: (() =>
                  Effect.dieMessage("unused")) as unknown as ContractWriterShape["estimateGas"],
                simulate: ((params: unknown) => {
                  calls.push({ kind: "simulate", params });
                  const amount = (params as { args?: readonly unknown[] }).args?.[1] as
                    | bigint
                    | undefined;
                  if ((amount ?? 0n) > 0n && nonZeroAttempt === 0) {
                    nonZeroAttempt += 1;
                    return Effect.fail(
                      new SimulationFailedError({
                        address: TEST_ADDRESS,
                        functionName: "approve",
                        message: "revert",
                        phase: "simulate",
                      })
                    );
                  }
                  return Effect.succeed({ request: {}, result: true });
                }) as unknown as ContractWriterShape["simulate"],
                write: ((params: unknown) => {
                  calls.push({ kind: "write", params });
                  writeAttempt += 1;
                  return Effect.succeed(writeAttempt === 1 ? TEST_TX_HASH : TEST_TX_HASH_2);
                }) as unknown as ContractWriterShape["write"],
              } satisfies ContractWriterShape)
            )
          );

          return Effect.gen(function* () {
            const service = yield* Erc20AllowanceService;

            const result = yield* service.ensureAllowance({
              account: TEST_ADDRESS,
              chainId: TEST_CHAIN_ID,
              required: 5n,
              spender: TEST_ADDRESS_2,
              tokenAddress: TEST_ADDRESS,
            });

            expect(result.status).toBe("approved");
            if (result.status !== "approved") {
              throw new Error("Expected approved result");
            }

            expect(result.mode).toBe("zero-first");
            expect(result.hashes).toEqual([TEST_TX_HASH, TEST_TX_HASH_2]);
            expect(calls.map((c) => c.kind)).toEqual([
              "read",
              "simulate", // direct attempt (fails)
              "simulate",
              "write", // approve(0)
              "simulate",
              "write", // approve(amount)
            ]);
          }).pipe(Effect.provide(Layer.provide(Erc20AllowanceServiceLive, deps)));
        })()
    );
  });

  describe("Erc20NoOutputAllowanceService", () => {
    it.effect("approve uses erc20NoOutputAbi, checkAllowance uses erc20Abi", () =>
      (() => {
        const calls: Call[] = [];
        return Effect.gen(function* () {
          const service = yield* Erc20NoOutputAllowanceService;

          yield* service.checkAllowance({
            chainId: TEST_CHAIN_ID,
            owner: TEST_ADDRESS,
            spender: TEST_ADDRESS_2,
            tokenAddress: TEST_ADDRESS,
          });

          yield* service.approve({
            account: TEST_ADDRESS,
            amount: 999n,
            chainId: TEST_CHAIN_ID,
            spender: TEST_ADDRESS_2,
            tokenAddress: TEST_ADDRESS,
          });

          expect(calls.map((c) => c.kind)).toEqual(["read", "simulate", "write"]);
          const readParams = calls[0]?.params as { abi: unknown };
          const simulateParams = calls[1]?.params as { abi: unknown };

          expect(readParams.abi).toBe(erc20Abi);
          expect(simulateParams.abi).toBe(erc20NoOutputAbi);
        }).pipe(
          Effect.provide(Layer.provide(Erc20NoOutputAllowanceServiceLive, makeDepsLayer(calls)))
        );
      })()
    );
  });
});
