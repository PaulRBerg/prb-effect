import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Stream } from "effect";
import type { Abi, Hash, TransactionReceipt } from "viem";
import { erc20Abi } from "viem";
import { ContractPipeline, ContractPipelineLive, ContractWriterLive } from "#src/contract/index.js";
import { ClientNotFoundError, EventDecodeError, ReceiptTimeoutError } from "#src/core/index.js";
import type { DecodedEvent } from "#src/events/index.js";
import { EventStream } from "#src/events/index.js";
import {
  makeMockGasServiceLayer,
  makeMockNonceServiceLayer,
  makeMockPublicClientLayer,
  makeMockWalletClientLayer,
  TEST_ADDRESS,
  TEST_ADDRESS_2,
  TEST_CHAIN_ID,
  TEST_TX_HASH,
} from "#src/testing-kit/index.js";
import { TxManager, TxReplacement } from "#src/tx/index.js";
import type { ContractEventName } from "#src/types/index.js";

const commonServices = Layer.mergeAll(
  makeMockGasServiceLayer({}, TEST_CHAIN_ID),
  makeMockNonceServiceLayer({}, TEST_CHAIN_ID),
  Layer.succeed(
    TxReplacement,
    TxReplacement.of({
      cancel: () => Effect.succeed(TEST_TX_HASH),
      speedup: () => Effect.succeed(TEST_TX_HASH),
    })
  )
);

type TxManagerShape = {
  readonly getConfirmations: (
    chainId: number,
    params: { hash: Hash } | { transactionReceipt: TransactionReceipt }
  ) => Effect.Effect<bigint, never>;
  readonly track: (
    chainId: number,
    hash: Hash,
    policy?: unknown
  ) => Effect.Effect<never, ClientNotFoundError>;
  readonly waitForReceipt: (
    chainId: number,
    hash: Hash,
    timeoutOrPolicy?: unknown
  ) => Effect.Effect<TransactionReceipt, ReceiptTimeoutError>;
};

type EventStreamShape = {
  readonly decodeReceipt: <TAbi extends Abi>(
    receipt: TransactionReceipt,
    abi: TAbi
  ) => Effect.Effect<DecodedEvent[], never>;
  readonly watch: <_TAbi extends Abi>(
    params: unknown
  ) => Effect.Effect<Stream.Stream<DecodedEvent>, never>;
};

type PipelineTestConfig = {
  publicClient?: Parameters<typeof makeMockPublicClientLayer>[0];
  walletClient?: Parameters<typeof makeMockWalletClientLayer>[0];
  txManager?: Partial<TxManagerShape>;
  eventStream?: Partial<EventStreamShape>;
};

const DEFAULT_RECEIPT: TransactionReceipt = {
  blockHash: "0x1234567890123456789012345678901234567890123456789012345678901234",
  blockNumber: 1000n,
  contractAddress: null,
  cumulativeGasUsed: 50000n,
  effectiveGasPrice: 1000000000n,
  from: TEST_ADDRESS,
  gasUsed: 50000n,
  logs: [],
  logsBloom: "0x00",
  status: "success",
  to: TEST_ADDRESS,
  transactionHash: TEST_TX_HASH,
  transactionIndex: 0,
  type: "eip1559",
};

const makeContractPipelineTestLayer = (config: PipelineTestConfig = {}) =>
  Layer.provide(
    ContractPipelineLive,
    Layer.mergeAll(
      Layer.provideMerge(
        ContractWriterLive,
        Layer.mergeAll(
          makeMockPublicClientLayer(config.publicClient ?? {}),
          makeMockWalletClientLayer(config.walletClient ?? {})
        )
      ),
      commonServices,
      Layer.succeed(
        TxManager,
        TxManager.of({
          getConfirmations: config.txManager?.getConfirmations ?? (() => Effect.succeed(0n)),
          track:
            config.txManager?.track ??
            (() =>
              Effect.fail(
                new ClientNotFoundError({
                  chainId: TEST_CHAIN_ID,
                  message: "Not used in this test",
                })
              )),
          waitForReceipt:
            config.txManager?.waitForReceipt ?? (() => Effect.succeed(DEFAULT_RECEIPT)),
        } as any)
      ),
      Layer.succeed(
        EventStream,
        EventStream.of({
          decodeReceipt:
            config.eventStream?.decodeReceipt ??
            (<_TAbi extends Abi>() => Effect.succeed([] as any)),
          watch: config.eventStream?.watch ?? (() => Effect.succeed(Stream.empty as any)),
        } as any)
      )
    )
  );

describe("ContractPipeline", () => {
  describe("writeAndWait", () => {
    it.effect("returns hash, receipt, and events on success", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const result = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        expect(result.hash).toBe(TEST_TX_HASH);
        expect(result.receipt).toBeDefined();
        expect(result.receipt.status).toBe("success");
        expect(result.events).toBeInstanceOf(Array);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            },
            walletClient: {
              writeContract: () => Promise.resolve(TEST_TX_HASH),
            },
          })
        )
      )
    );

    it.effect("fails with ContractWriteError on simulate failure", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const exit = yield* pipeline
          .writeAndWait({
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
          makeContractPipelineTestLayer({
            publicClient: {
              simulateContract: () => Promise.reject(new Error("Simulation failed")),
            },
          })
        )
      )
    );

    it.effect("fails with ContractWriteError on write failure", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const exit = yield* pipeline
          .writeAndWait({
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
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            },
            walletClient: {
              writeContract: () => Promise.reject(new Error("Write failed")),
            },
          })
        )
      )
    );

    it.effect("fails with ReceiptTimeoutError on timeout", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const exit = yield* pipeline
          .writeAndWait({
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
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            },
            txManager: {
              waitForReceipt: () =>
                Effect.fail(
                  new ReceiptTimeoutError({
                    hash: TEST_TX_HASH,
                    message: "Timeout waiting for receipt",
                    timeout: 120_000,
                  })
                ),
            },
            walletClient: {
              writeContract: () => Promise.resolve(TEST_TX_HASH),
            },
          })
        )
      )
    );

    it.effect("uses optional policy parameter when provided", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const result = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          policy: {
            pollingInterval: 2000,
            receiptTimeout: 60_000,
            replacementStrategy: "speedup",
          },
        });

        expect(result.hash).toBe(TEST_TX_HASH);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            },
            walletClient: {
              writeContract: () => Promise.resolve(TEST_TX_HASH),
            },
          })
        )
      )
    );

    it.effect("decodes events from receipt logs", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const mockEvent: DecodedEvent = {
          address: TEST_ADDRESS,
          args: { from: TEST_ADDRESS, to: TEST_ADDRESS_2, value: 100n },
          blockNumber: 1000n,
          eventName: "Transfer",
          logIndex: 0,
          removed: false,
          transactionHash: TEST_TX_HASH,
        };

        const result = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toEqual(mockEvent);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            eventStream: {
              decodeReceipt: <TAbi extends Abi>() =>
                Effect.succeed([
                  {
                    address: TEST_ADDRESS,
                    args: {
                      from: TEST_ADDRESS,
                      to: TEST_ADDRESS_2,
                      value: 100n,
                    },
                    blockNumber: 1000n,
                    eventName: "Transfer" as const,
                    logIndex: 0,
                    removed: false,
                    transactionHash: TEST_TX_HASH,
                  },
                ] as unknown as DecodedEvent<TAbi, ContractEventName<TAbi>>[]),
            },
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            },
            walletClient: {
              writeContract: () => Promise.resolve(TEST_TX_HASH),
            },
          })
        )
      )
    );

    it.effect("fails early on gas estimation failure", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const exit = yield* pipeline
          .writeAndWait({
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
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.reject(new Error("Gas estimation failed")),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            },
          })
        )
      )
    );

    it.effect("estimates gas before simulation and passes gas limit to simulation", () => {
      const calls: string[] = [];
      let simulationGasParam: bigint | undefined;

      return Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        // Verify gas estimation happens before simulation (order matters for RPC compatibility)
        expect(calls).toEqual(["estimateContractGas", "simulateContract"]);

        // Verify simulation receives the exact expected gas (50000 * 1.1 multiplier = 55000)
        expect(simulationGasParam).toBe(55000n);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => {
                calls.push("estimateContractGas");
                return Promise.resolve(50000n);
              },
              simulateContract: (params: unknown) => {
                calls.push("simulateContract");
                simulationGasParam = (params as { gas?: bigint }).gas;
                return Promise.resolve({ request: {}, result: true });
              },
            },
            walletClient: {
              writeContract: () => Promise.resolve(TEST_TX_HASH),
            },
          })
        )
      );
    });

    it.effect("explicit gas override takes precedence over estimated gas", () => {
      let simulationGasParam: bigint | undefined;
      const EXPLICIT_GAS = 100000n;

      return Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          gas: EXPLICIT_GAS,
        });

        // Explicit gas should be used instead of estimated (50000 * 1.1 = 55000)
        expect(simulationGasParam).toBe(EXPLICIT_GAS);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: (params: unknown) => {
                simulationGasParam = (params as { gas?: bigint }).gas;
                return Promise.resolve({ request: {}, result: true });
              },
            },
            walletClient: {
              writeContract: () => Promise.resolve(TEST_TX_HASH),
            },
          })
        )
      );
    });

    it.effect("best-effort mode continues after gas estimation failure", () => {
      let estimateCalls = 0;
      let simulateCalls = 0;
      let writeCalls = 0;

      return Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const result = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "best-effort" },
        });

        expect(result.hash).toBe(TEST_TX_HASH);
        expect(estimateCalls).toBe(1);
        expect(simulateCalls).toBe(0);
        expect(writeCalls).toBe(1);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => {
                estimateCalls += 1;
                return Promise.reject(new Error("execution reverted: WithdrawWindowClosed"));
              },
              simulateContract: () => {
                simulateCalls += 1;
                return Promise.resolve({ request: {}, result: true });
              },
            },
            walletClient: {
              writeContract: () => {
                writeCalls += 1;
                return Promise.resolve(TEST_TX_HASH);
              },
            },
          })
        )
      );
    });

    it.effect("best-effort mode continues on non-execution gas estimation error", () => {
      let writeCalls = 0;

      return Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const result = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "best-effort" },
        });

        expect(result.hash).toBe(TEST_TX_HASH);
        expect(writeCalls).toBe(1);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.reject(new Error("RPC timeout")),
            },
            walletClient: {
              writeContract: () => {
                writeCalls += 1;
                return Promise.resolve(TEST_TX_HASH);
              },
            },
          })
        )
      );
    });

    it.effect("none mode skips estimate and simulation", () => {
      let estimateCalls = 0;
      let simulateCalls = 0;
      let writeCalls = 0;

      return Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const result = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "none" },
        });

        expect(result.hash).toBe(TEST_TX_HASH);
        expect(estimateCalls).toBe(0);
        expect(simulateCalls).toBe(0);
        expect(writeCalls).toBe(1);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => {
                estimateCalls += 1;
                return Promise.resolve(50000n);
              },
              simulateContract: () => {
                simulateCalls += 1;
                return Promise.resolve({ request: {}, result: true });
              },
            },
            walletClient: {
              writeContract: () => {
                writeCalls += 1;
                return Promise.resolve(TEST_TX_HASH);
              },
            },
          })
        )
      );
    });
  });

  describe("writeAndTrack", () => {
    it.effect("returns stateRef and result effect", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { stateRef, result } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        expect(stateRef).toBeDefined();
        expect(result).toBeDefined();

        // Execute the result
        const finalResult = yield* result;
        expect(finalResult.hash).toBe(TEST_TX_HASH);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            },
            walletClient: {
              writeContract: () => Promise.resolve(TEST_TX_HASH),
            },
          })
        ),
        Effect.scoped
      )
    );

    it.effect("state transitions through expected phases", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { stateRef, result } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        // Execute the result and check final state
        const finalResult = yield* result;
        const finalState = yield* stateRef.get;

        expect(finalResult.hash).toBe(TEST_TX_HASH);
        expect(finalState.status).toBe("mined");
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            },
            walletClient: {
              writeContract: () => Promise.resolve(TEST_TX_HASH),
            },
          })
        ),
        Effect.scoped
      )
    );

    it.effect("strict preflight fails on gas estimation and marks preflight phase", () => {
      let writeCalls = 0;

      return Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { result, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "strict" },
        });

        const exit = yield* result.pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(writeCalls).toBe(0);

        const state = yield* stateRef.get;
        expect(state.status).toBe("failed");
        if (state.status === "failed") {
          expect(state.phase).toBe("preflight");
        }
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () =>
                Promise.reject(new Error("execution reverted: WithdrawWindowClosed")),
            },
            walletClient: {
              writeContract: () => {
                writeCalls += 1;
                return Promise.resolve(TEST_TX_HASH);
              },
            },
          })
        ),
        Effect.scoped
      );
    });

    it.effect("best-effort continues after gas estimation failure", () => {
      let estimateCalls = 0;
      let simulateCalls = 0;
      let writeCalls = 0;

      return Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { result, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "best-effort" },
        });

        const finalResult = yield* result;
        expect(finalResult.hash).toBe(TEST_TX_HASH);
        expect(estimateCalls).toBe(1);
        expect(simulateCalls).toBe(0);
        expect(writeCalls).toBe(1);

        const state = yield* stateRef.get;
        expect(state.status).toBe("mined");
        if (state.status === "mined") {
          expect(state.preflightWarning?.phase).toBe("estimate");
        }
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => {
                estimateCalls += 1;
                return Promise.reject(new Error("execution reverted: WithdrawWindowClosed"));
              },
              simulateContract: () => {
                simulateCalls += 1;
                return Promise.resolve({ request: {}, result: true });
              },
            },
            walletClient: {
              writeContract: () => {
                writeCalls += 1;
                return Promise.resolve(TEST_TX_HASH);
              },
            },
          })
        ),
        Effect.scoped
      );
    });

    it.effect("best-effort continues on non-execution gas estimation error", () => {
      let writeCalls = 0;

      return Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { result, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "best-effort" },
        });

        const finalResult = yield* result;
        expect(finalResult.hash).toBe(TEST_TX_HASH);
        expect(writeCalls).toBe(1);

        const state = yield* stateRef.get;
        expect(state.status).toBe("mined");
        if (state.status === "mined") {
          expect(state.preflightWarning?.phase).toBe("estimate");
          expect(state.preflightWarning?.reason).toContain("Failed to estimate gas");
        }
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.reject(new Error("RPC timeout")),
            },
            walletClient: {
              writeContract: () => {
                writeCalls += 1;
                return Promise.resolve(TEST_TX_HASH);
              },
            },
          })
        ),
        Effect.scoped
      );
    });

    it.effect("best-effort continues after simulation failure", () => {
      let estimateCalls = 0;
      let simulateCalls = 0;
      let writeCalls = 0;

      return Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { result, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "best-effort" },
        });

        const finalResult = yield* result;
        expect(finalResult.hash).toBe(TEST_TX_HASH);
        expect(estimateCalls).toBe(1);
        expect(simulateCalls).toBe(1);
        expect(writeCalls).toBe(1);

        const state = yield* stateRef.get;
        expect(state.status).toBe("mined");
        if (state.status === "mined") {
          expect(state.preflightWarning?.phase).toBe("simulate");
          expect(state.preflightWarning?.reason).toContain("allowance");
        }
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => {
                estimateCalls += 1;
                return Promise.resolve(50000n);
              },
              simulateContract: () => {
                simulateCalls += 1;
                return Promise.reject(
                  new Error("execution reverted: ERC20: transfer amount exceeds allowance")
                );
              },
            },
            walletClient: {
              writeContract: () => {
                writeCalls += 1;
                return Promise.resolve(TEST_TX_HASH);
              },
            },
          })
        ),
        Effect.scoped
      );
    });

    it.effect("none mode skips estimate and simulation", () => {
      let estimateCalls = 0;
      let simulateCalls = 0;
      let writeCalls = 0;

      return Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { result } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "none" },
        });

        const finalResult = yield* result;
        expect(finalResult.hash).toBe(TEST_TX_HASH);
        expect(estimateCalls).toBe(0);
        expect(simulateCalls).toBe(0);
        expect(writeCalls).toBe(1);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => {
                estimateCalls += 1;
                return Promise.resolve(50000n);
              },
              simulateContract: () => {
                simulateCalls += 1;
                return Promise.resolve({ request: {}, result: true });
              },
            },
            walletClient: {
              writeContract: () => {
                writeCalls += 1;
                return Promise.resolve(TEST_TX_HASH);
              },
            },
          })
        ),
        Effect.scoped
      );
    });

    it.effect("marks receipt phase when receipt waiting fails", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { result, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        const exit = yield* result.pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);

        const state = yield* stateRef.get;
        expect(state.status).toBe("failed");
        if (state.status === "failed") {
          expect(state.phase).toBe("receipt");
        }
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            },
            txManager: {
              waitForReceipt: () =>
                Effect.fail(
                  new ReceiptTimeoutError({
                    hash: TEST_TX_HASH,
                    message: "Timeout waiting for receipt",
                    timeout: 120_000,
                  })
                ),
            },
            walletClient: {
              writeContract: () => Promise.resolve(TEST_TX_HASH),
            },
          })
        ),
        Effect.scoped
      )
    );

    it.effect("marks event-decode phase when decoding fails", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { result, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        const exit = yield* result.pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);

        const state = yield* stateRef.get;
        expect(state.status).toBe("failed");
        if (state.status === "failed") {
          expect(state.phase).toBe("event-decode");
        }
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            eventStream: {
              decodeReceipt: (() =>
                Effect.fail(
                  new EventDecodeError({
                    log: { bad: true },
                    message: "Failed to decode event",
                  })
                )) as unknown as EventStreamShape["decodeReceipt"],
            },
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            },
            walletClient: {
              writeContract: () => Promise.resolve(TEST_TX_HASH),
            },
          })
        ),
        Effect.scoped
      )
    );
  });
});
