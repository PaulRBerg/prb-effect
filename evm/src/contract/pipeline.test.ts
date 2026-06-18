import { describe, expect, it } from "@effect/vitest";
import { Chunk, Effect, Exit, Layer, Stream, SubscriptionRef } from "effect";
import type { Abi, Hash, TransactionReceipt } from "viem";
import { erc20Abi } from "viem";
import { ContractPipeline, ContractPipelineLive, ContractWriterLive } from "#src/contract/index.js";
import { ClientNotFoundError, EventDecodeError, ReceiptTimeoutError } from "#src/core/index.js";
import type { DecodedEvent } from "#src/events/index.js";
import { EventStream } from "#src/events/index.js";
import { NonceService } from "#src/nonce/index.js";
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
import type { TxState } from "#src/tx/index.js";
import { TxManager, TxReplacement } from "#src/tx/index.js";
import type { ContractEventName } from "#src/types/index.js";
import type { WriteExecutionAdapterShape } from "./pipeline/adapter.js";
import { WriteExecutionAdapter } from "./pipeline/adapter.js";
import type { WriteAndTrackTerminal } from "./pipeline/types.js";

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
  adapter?: {
    canHandle: boolean;
    writeAndTrack?: WriteExecutionAdapterShape["writeAndTrack"];
  };
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

function expectSuccessTerminal<TAbi extends Abi>(
  terminal: WriteAndTrackTerminal<TAbi>
): Extract<WriteAndTrackTerminal<TAbi>, { _tag: "success" }> {
  expect(terminal._tag).toBe("success");
  if (terminal._tag !== "success") {
    throw new Error(`Expected success terminal, got ${terminal._tag}`);
  }
  return terminal;
}

const makeAdapterLayer = (adapter: NonNullable<PipelineTestConfig["adapter"]>) =>
  Layer.succeed(
    WriteExecutionAdapter,
    WriteExecutionAdapter.of({
      canHandle: () => Effect.succeed(adapter.canHandle),
      writeAndTrack: (params) =>
        adapter.writeAndTrack
          ? adapter.writeAndTrack(params)
          : Effect.gen(function* () {
              const stateRef = yield* SubscriptionRef.make({
                status: "idle",
              } as any);
              return {
                actions: {
                  cancel: () => Effect.succeed(TEST_TX_HASH),
                  speedup: () => Effect.succeed(TEST_TX_HASH),
                },
                stateRef,
                terminal: Effect.succeed({
                  _tag: "success",
                  events: [],
                  hash: TEST_TX_HASH,
                  receipt: DEFAULT_RECEIPT,
                }),
              };
            }),
    })
  );

const makeContractPipelineTestLayer = (config: PipelineTestConfig = {}) => {
  const pipelineLayer = Layer.provide(
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

  // A9: the adapter is provided ALONGSIDE the pipeline (in the caller's context),
  // not beneath ContractPipelineLive. The pipeline resolves it at call time via
  // `serviceOption`, mirroring the consumer's `provideMerge(safeLayer, baseLayer)`.
  return config.adapter
    ? Layer.merge(pipelineLayer, makeAdapterLayer(config.adapter))
    : pipelineLayer;
};

describe("ContractPipeline", () => {
  describe("writeAndWait", () => {
    it.effect("returns hash, receipt, and events on success", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const terminal = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });
        const result = expectSuccessTerminal(terminal);

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

        const terminal = yield* pipeline.writeAndWait({
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
        const result = expectSuccessTerminal(terminal);

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

        const terminal = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });
        const result = expectSuccessTerminal(terminal);

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
                    blockNumber: 1000n,
                    eventName: "Transfer" as const,
                    logIndex: 0,
                    removed: false,
                    transactionHash: TEST_TX_HASH,
                    args: {
                      from: TEST_ADDRESS,
                      to: TEST_ADDRESS_2,
                      value: 100n,
                    },
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

        const terminal = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "best-effort" },
        });
        const result = expectSuccessTerminal(terminal);

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

        const terminal = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "best-effort" },
        });
        const result = expectSuccessTerminal(terminal);

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

        const terminal = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "none" },
        });
        const result = expectSuccessTerminal(terminal);

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
    it.effect("returns stateRef and terminal effect", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { stateRef, terminal } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        expect(stateRef).toBeDefined();
        expect(terminal).toBeDefined();

        const finalTerminal = yield* terminal;
        const finalResult = expectSuccessTerminal(finalTerminal);
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

        const { stateRef, terminal } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        const finalTerminal = yield* terminal;
        const finalResult = expectSuccessTerminal(finalTerminal);
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

        const { terminal, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "strict" },
        });

        const exit = yield* terminal.pipe(Effect.exit);
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

        const { terminal, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "best-effort" },
        });

        const finalTerminal = yield* terminal;
        const finalResult = expectSuccessTerminal(finalTerminal);
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

        const { terminal, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "best-effort" },
        });

        const finalTerminal = yield* terminal;
        const finalResult = expectSuccessTerminal(finalTerminal);
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

        const { terminal, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "best-effort" },
        });

        const finalTerminal = yield* terminal;
        const finalResult = expectSuccessTerminal(finalTerminal);
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

        const { terminal } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
          preflight: { mode: "none" },
        });

        const finalTerminal = yield* terminal;
        const finalResult = expectSuccessTerminal(finalTerminal);
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

        const { terminal, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        const exit = yield* terminal.pipe(Effect.exit);
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

        const { terminal, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        const exit = yield* terminal.pipe(Effect.exit);
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

  describe("adapter routing", () => {
    it.effect("uses execution adapter when it can handle params", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { terminal, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        const finalTerminal = yield* terminal;
        const final = expectSuccessTerminal(finalTerminal);
        const current = yield* stateRef.get;

        expect(final.hash).toBe(TEST_TX_HASH);
        expect(current.status).toBe("idle");
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            adapter: {
              canHandle: true,
            },
            walletClient: {
              writeContract: () => Promise.reject(new Error("Should not hit default write path")),
            },
          })
        ),
        Effect.scoped
      )
    );

    it.effect("writeAndWait returns queued terminal from adapter", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const terminal = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        expect(terminal).toEqual({
          _tag: "queued",
          reason: "awaiting-safe-confirmations",
          reference: TEST_TX_HASH,
          details: {
            confirmations: 1,
            confirmationsRequired: 2,
            lastStatus: "awaiting_confirmations",
          },
        });
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            adapter: {
              canHandle: true,
              writeAndTrack: () =>
                Effect.gen(function* () {
                  const stateRef = yield* SubscriptionRef.make<TxState>({
                    status: "queued",
                  });
                  return {
                    actions: {
                      cancel: () => Effect.succeed(TEST_TX_HASH),
                      speedup: () => Effect.succeed(TEST_TX_HASH),
                    },
                    stateRef,
                    terminal: Effect.succeed({
                      _tag: "queued",
                      reason: "awaiting-safe-confirmations",
                      reference: TEST_TX_HASH,
                      details: {
                        confirmations: 1,
                        confirmationsRequired: 2,
                        lastStatus: "awaiting_confirmations",
                      },
                    }),
                  };
                }),
            },
            walletClient: {
              writeContract: () => Promise.reject(new Error("Should not hit default write path")),
            },
          })
        ),
        Effect.scoped
      )
    );

    it.effect("writeAndWait returns cancelled terminal from adapter", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const terminal = yield* pipeline.writeAndWait({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        expect(terminal).toEqual({
          _tag: "cancelled",
          reason: "safe-cancelled",
          reference: TEST_TX_HASH,
        });
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            adapter: {
              canHandle: true,
              writeAndTrack: () =>
                Effect.gen(function* () {
                  const stateRef = yield* SubscriptionRef.make<TxState>({
                    status: "cancelled",
                  });
                  return {
                    actions: {
                      cancel: () => Effect.succeed(TEST_TX_HASH),
                      speedup: () => Effect.succeed(TEST_TX_HASH),
                    },
                    stateRef,
                    terminal: Effect.succeed({
                      _tag: "cancelled",
                      reason: "safe-cancelled",
                      reference: TEST_TX_HASH,
                    }),
                  };
                }),
            },
            walletClient: {
              writeContract: () => Promise.reject(new Error("Should not hit default write path")),
            },
          })
        ),
        Effect.scoped
      )
    );

    it.effect("falls back to default write path when adapter declines", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { terminal } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        const finalTerminal = yield* terminal;
        const final = expectSuccessTerminal(finalTerminal);
        expect(final.hash).toBe(TEST_TX_HASH);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            adapter: {
              canHandle: false,
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

    // A9: the adapter must be resolved from the caller's context at call time, not
    // captured at layer-build time. Here the pipeline layer is built WITHOUT the
    // adapter in its build context; the adapter is provided alongside it at the call
    // site — mirroring the consumer's natural `provideMerge(safeLayer, baseLayer)`.
    it.effect("resolves adapter provided at call time even when absent at build time", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { terminal, stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        const finalTerminal = yield* terminal;
        const final = expectSuccessTerminal(finalTerminal);
        const current = yield* stateRef.get;

        // Adapter handled the write: its stateRef starts "idle" and the default
        // wallet write path (which rejects below) is never hit.
        expect(final.hash).toBe(TEST_TX_HASH);
        expect(current.status).toBe("idle");
      }).pipe(
        Effect.provide(
          // Pipeline layer has NO adapter in its build context.
          makeContractPipelineTestLayer({
            walletClient: {
              writeContract: () => Promise.reject(new Error("Should not hit default write path")),
            },
          })
        ),
        // Adapter is provided at call time, outside the pipeline's build context.
        Effect.provide(makeAdapterLayer({ canHandle: true })),
        Effect.scoped
      )
    );

    it.effect("uses default EOA path when no adapter is present in the call context", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { terminal } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        const finalTerminal = yield* terminal;
        const final = expectSuccessTerminal(finalTerminal);
        expect(final.hash).toBe(TEST_TX_HASH);
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
  });

  describe("nonce reservation lifecycle", () => {
    // Pipeline layer with controllable nonce mock, wallet write outcome, and receipt
    // result. Built with `provideMerge` so the mock services (NonceService in
    // particular) stay reachable from the test program after the write.
    const makeNonceLifecycleTestLayer = (config: {
      nonceLayer: Layer.Layer<NonceService>;
      receipt: TransactionReceipt;
      writeContract: () => Promise<Hash>;
    }) => {
      const deps = Layer.mergeAll(
        Layer.provideMerge(
          ContractWriterLive,
          Layer.mergeAll(
            makeMockPublicClientLayer({
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            }),
            makeMockWalletClientLayer({ writeContract: config.writeContract })
          )
        ),
        makeMockGasServiceLayer({}, TEST_CHAIN_ID),
        config.nonceLayer,
        Layer.succeed(
          TxReplacement,
          TxReplacement.of({
            cancel: () => Effect.succeed(TEST_TX_HASH),
            speedup: () => Effect.succeed(TEST_TX_HASH),
          })
        ),
        Layer.succeed(
          TxManager,
          TxManager.of({
            getConfirmations: () => Effect.succeed(0n),
            track: () =>
              Effect.fail(new ClientNotFoundError({ chainId: TEST_CHAIN_ID, message: "unused" })),
            waitForReceipt: () => Effect.succeed(config.receipt),
          } as any)
        ),
        Layer.succeed(
          EventStream,
          EventStream.of({
            decodeReceipt: () => Effect.succeed([] as any),
            watch: () => Effect.succeed(Stream.empty as any),
          } as any)
        )
      );

      return Layer.provideMerge(ContractPipelineLive, deps);
    };

    // A1: a wallet rejection (write failure) must release the reserved nonce
    // immediately — when the write's own scope closes — not at the caller's
    // long-lived tracking-scope close. The freed nonce must be re-reservable at the
    // same value so a retry does not open a nonce gap.
    it.effect("releases the reserved nonce immediately when the write fails", () => {
      const reserved = new Set<bigint>();
      let nextNonce = 0n;

      const reserve = () =>
        Effect.sync(() => {
          let candidate = 0n;
          while (reserved.has(candidate) || candidate < nextNonce) {
            candidate += 1n;
          }
          reserved.add(candidate);
          return candidate;
        });
      const release = (params: { nonce: bigint }) =>
        Effect.sync(() => {
          reserved.delete(params.nonce);
        });
      const confirm = (params: { nonce: bigint }) =>
        Effect.sync(() => {
          reserved.delete(params.nonce);
          nextNonce = params.nonce + 1n;
        });

      const nonceLayer = makeMockNonceServiceLayer({ confirm, release, reserve }, TEST_CHAIN_ID);

      return Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        // First write: nonce 0 is reserved, then the wallet rejects the prompt.
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

        // The reservation's release finalizer fired with the write's scope close, so
        // the manager holds no pending nonces.
        expect(reserved.size).toBe(0);

        // A retry re-reserves the SAME nonce (0) rather than opening a gap at 1.
        const nonceService = yield* NonceService;
        const reReserved = yield* nonceService.reserve({
          address: TEST_ADDRESS,
          chainId: TEST_CHAIN_ID,
        });
        expect(reReserved).toBe(0n);
      }).pipe(
        Effect.provide(
          makeNonceLifecycleTestLayer({
            nonceLayer,
            receipt: DEFAULT_RECEIPT,
            writeContract: () => Promise.reject(new Error("User rejected the request")),
          })
        )
      );
    });

    // A1: a reverted tx still consumes its nonce on-chain, so `confirm` must run for
    // reverted receipts too — otherwise the nonce leaks in the manager's pending set.
    it.effect("confirms the nonce when the receipt reverts", () => {
      const confirmed: bigint[] = [];
      const confirm = (params: { nonce: bigint }) =>
        Effect.sync(() => {
          confirmed.push(params.nonce);
        });

      const revertedReceipt: TransactionReceipt = { ...DEFAULT_RECEIPT, status: "reverted" };
      const nonceLayer = makeMockNonceServiceLayer(
        { confirm, reserve: () => Effect.succeed(7n) },
        TEST_CHAIN_ID
      );

      return Effect.gen(function* () {
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

        // The tx reverted, so the terminal fails...
        expect(Exit.isFailure(exit)).toBe(true);
        // ...but the nonce was still confirmed (consumed on-chain).
        expect(confirmed).toEqual([7n]);
      }).pipe(
        Effect.provide(
          makeNonceLifecycleTestLayer({
            nonceLayer,
            receipt: revertedReceipt,
            writeContract: () => Promise.resolve(TEST_TX_HASH),
          })
        )
      );
    });
  });

  describe("terminal lifecycle", () => {
    // B2 (evm): if the tracking scope closes mid-flight, the forked pipeline fiber is
    // interrupted before resolving `terminalDeferred`. The `Deferred.interrupt`
    // finalizer must make an out-of-scope `terminal` awaiter fail with interruption
    // instead of hanging forever.
    it.effect("terminal awaiter fails with interruption when the scope closes mid-flight", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        // Acquire the execution inside a scope we control, then close that scope
        // while `waitForReceipt` is still blocked. Capture the terminal effect so we
        // can await it AFTER the scope has closed.
        const terminal = yield* Effect.scoped(
          Effect.gen(function* () {
            const execution = yield* pipeline.writeAndTrack({
              abi: erc20Abi,
              account: TEST_ADDRESS,
              address: TEST_ADDRESS,
              args: [TEST_ADDRESS_2, 100n],
              chainId: TEST_CHAIN_ID,
              functionName: "transfer",
            });

            // Let the forked fiber advance toward the blocked receipt wait.
            yield* Effect.yieldNow();
            return execution.terminal;
          })
        );

        // Scope is now closed; the forked fiber was interrupted before resolving the
        // Deferred. Awaiting must terminate (with interruption), not hang.
        const exit = yield* terminal.pipe(Effect.exit);
        expect(Exit.isInterrupted(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
            },
            txManager: {
              // Never resolves: keeps the pipeline blocked at the receipt wait so the
              // scope closes mid-flight.
              waitForReceipt: () => Effect.never as any,
            },
            walletClient: {
              writeContract: () => Promise.resolve(TEST_TX_HASH),
            },
          })
        )
      )
    );
  });

  describe("pending confirmations", () => {
    // A6 (pipeline side): an unmined tx has zero confirmations. The internal
    // blocks-elapsed counter (stuck-tx detection) must not be published as
    // `confirmations` — the old code reported "pending, confirmations: 7".
    it.live("publishes confirmations: 0 while the tx is still pending", () =>
      Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;

        const { stateRef } = yield* pipeline.writeAndTrack({
          abi: erc20Abi,
          account: TEST_ADDRESS,
          address: TEST_ADDRESS,
          args: [TEST_ADDRESS_2, 100n],
          chainId: TEST_CHAIN_ID,
          functionName: "transfer",
        });

        // Blocks tick every 5ms while the receipt wait takes 40ms, so several
        // pending updates fire (blocksElapsed climbs past 1) before mining.
        const states = Chunk.toArray(
          yield* stateRef.changes.pipe(
            Stream.takeUntil((state) => state.status === "mined"),
            Stream.runCollect
          )
        );

        const pendings = states.filter((state) => state.status === "pending");
        expect(pendings.length).toBeGreaterThan(0);
        for (const pending of pendings) {
          if (pending.status === "pending") {
            expect(pending.confirmations).toBe(0);
          }
        }
      }).pipe(
        Effect.provide(
          makeContractPipelineTestLayer({
            publicClient: {
              estimateContractGas: () => Promise.resolve(50000n),
              simulateContract: () => Promise.resolve({ request: {}, result: true }),
              watchBlockNumber: (params: unknown) => {
                const { onBlockNumber } = params as { onBlockNumber: (n: bigint) => void };
                let blockNumber = 100n;
                const id = setInterval(() => {
                  blockNumber += 1n;
                  onBlockNumber(blockNumber);
                }, 5);
                return () => clearInterval(id);
              },
            },
            txManager: {
              waitForReceipt: () => Effect.succeed(DEFAULT_RECEIPT).pipe(Effect.delay("40 millis")),
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
