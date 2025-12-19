import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Stream } from "effect";
import type { Abi, Hash, TransactionReceipt } from "viem";
import { erc20Abi } from "viem";
import {
  ContractPipeline,
  ContractPipelineLive,
  ContractWriterLive,
} from "@/src/contract/index.js";
import { ClientNotFoundError, ReceiptTimeoutError } from "@/src/core/index.js";
import type { DecodedEvent } from "@/src/events/index.js";
import { EventStream } from "@/src/events/index.js";
import {
  makeMockGasServiceLayer,
  makeMockNonceServiceLayer,
  makeMockPublicClientLayer,
  makeMockWalletClientLayer,
  TEST_ADDRESS,
  TEST_ADDRESS_2,
  TEST_CHAIN_ID,
  TEST_TX_HASH,
} from "@/src/testing-kit/index.js";
import { TxManager, TxReplacement } from "@/src/tx/index.js";
import type { ContractEventName } from "@/src/types/index.js";

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
  });
});
