import type { Idl, Program } from "@coral-xyz/anchor";
import { describe, expect, it } from "@effect/vitest";
import type { Address } from "@solana/addresses";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { Cause, Effect, Exit, Layer, Logger } from "effect";
import { WalletNotConnectedError } from "#src/core/errors/index.js";
import {
  makeMockRpc as makeBaseMockRpc,
  makeMockRpcServiceLayer,
  makeMockSignerServiceLayer,
} from "#src/testing-kit/index.js";
import {
  InstructionNotFoundError,
  ProgramCreationError,
  ProgramReadError,
  ProgramReader,
  ProgramReaderLive,
  ViewNotSupportedError,
} from "./index.js";

// Minimal IDL for testing
const TEST_IDL: Idl = {
  address: "11111111111111111111111111111111",
  instructions: [
    {
      accounts: [
        { name: "from", signer: true, writable: true },
        { name: "to", signer: false, writable: true },
      ],
      args: [{ name: "amount", type: "u64" }],
      discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
      name: "transfer",
    },
  ],
  metadata: {
    name: "testProgram",
    spec: "0.1.0",
    version: "0.1.0",
  },
};

const VIEW_IDL: Idl = {
  address: "11111111111111111111111111111111",
  instructions: [
    {
      accounts: [{ name: "stream", signer: false, writable: false }],
      args: [],
      discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
      name: "viewValue",
      returns: "u64",
    },
  ],
  metadata: {
    name: "testProgram",
    spec: "0.1.0",
    version: "0.1.0",
  },
};

const TEST_ADDRESS = "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK" as Address;
const ALT_TEST_ADDRESS = "4vJ9JU1bJJE96FWSJJh8Aj9G5s8frW6m3jS9S4vD5tZQ" as Address;
const TEST_PROGRAM_ADDRESS = "11111111111111111111111111111111";

function encodeU64(value: bigint): string {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return Buffer.from(bytes).toString("base64");
}

const makeMockRpc = (config?: {
  readonly includeReturnData?: boolean;
  readonly onSimulateConfig?: (
    config: Parameters<Rpc<SolanaRpcApi>["simulateTransaction"]>[1]
  ) => void;
  readonly onSimulateTransaction?: (wireTransaction: string) => void;
  readonly simulationError?: unknown;
  readonly viewReturn?: bigint;
}): Rpc<SolanaRpcApi> =>
  makeBaseMockRpc({
    simulateTransaction: ((...args: Parameters<Rpc<SolanaRpcApi>["simulateTransaction"]>) => {
      const [wireTransaction, options] = args;
      if (typeof wireTransaction === "string") {
        config?.onSimulateTransaction?.(wireTransaction);
      }
      config?.onSimulateConfig?.(options);

      return {
        send: () =>
          Promise.resolve({
            context: { slot: 0n },
            value: {
              err: config?.simulationError ?? null,
              logs:
                config?.viewReturn !== undefined
                  ? [`Program return: ${TEST_PROGRAM_ADDRESS} ${encodeU64(config.viewReturn)}`]
                  : [],
              returnData:
                config?.includeReturnData === true && config?.viewReturn !== undefined
                  ? {
                      data: [encodeU64(config.viewReturn), "base64"] as const,
                      programId: TEST_PROGRAM_ADDRESS as Address,
                    }
                  : null,
            },
          }),
      };
    }) as Rpc<SolanaRpcApi>["simulateTransaction"],
  });

const makeTestLayer = (config?: {
  readonly disconnected?: boolean;
  readonly includeReturnData?: boolean;
  readonly onSimulateConfig?: (
    config: Parameters<Rpc<SolanaRpcApi>["simulateTransaction"]>[1]
  ) => void;
  readonly onSimulateTransaction?: (wireTransaction: string) => void;
  readonly simulationError?: unknown;
  readonly viewReturn?: bigint;
}) => {
  const rpcLayer = makeMockRpcServiceLayer({
    getRpc: () => Effect.succeed(makeMockRpc(config)),
  });
  const signerLayer = makeMockSignerServiceLayer(
    config?.disconnected ? { connected: false } : { address: TEST_ADDRESS }
  );
  return Layer.provide(ProgramReaderLive, Layer.mergeAll(rpcLayer, signerLayer));
};

function makeTestTransaction(): Transaction {
  const transaction = new Transaction();
  transaction.add(
    new TransactionInstruction({
      data: Buffer.alloc(0),
      keys: [],
      programId: new PublicKey(TEST_PROGRAM_ADDRESS),
    })
  );
  return transaction;
}

function expectFailError<E>(exit: Exit.Exit<unknown, E>): E {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected failure exit");
  }

  const failure = Cause.failureOption(exit.cause);
  if (failure._tag === "None") {
    throw new Error(`Expected fail cause, got "${exit.cause._tag}"`);
  }

  return failure.value;
}

function expectDieError(exit: Exit.Exit<unknown, unknown>): unknown {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected failure exit");
  }

  const defect = Cause.dieOption(exit.cause);
  if (defect._tag === "None") {
    throw new Error(`Expected die cause, got "${exit.cause._tag}"`);
  }

  return defect.value;
}

describe("ProgramReader", () => {
  describe("createProgram", () => {
    it.effect("creates a Program instance from valid IDL with signer", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const program = yield* reader.createProgram({ idl: TEST_IDL });

        expect(program).toBeDefined();
        expect(program.idl.metadata?.name).toBe("testProgram");
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("uses programId override when provided", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const customProgramId = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
        const program = yield* reader.createProgram({
          idl: TEST_IDL,
          programId: customProgramId,
        });

        expect(program).toBeDefined();
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("returns ProgramCreationError on invalid IDL", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const invalidIdl = { invalid: true } as unknown as Idl;
        const exit = yield* Effect.exit(reader.createProgram({ idl: invalidIdl }));

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(ProgramCreationError);
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("fails with WalletNotConnectedError when signer unavailable", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const exit = yield* Effect.exit(reader.createProgram({ idl: TEST_IDL }));

        const error = expectFailError(exit);
        expect(error._tag).toBe("WalletNotConnectedError");
      }).pipe(Effect.provide(makeTestLayer({ disconnected: true })))
    );
  });

  describe("view", () => {
    it.effect("returns InstructionNotFoundError for non-existent method", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const exit = yield* Effect.exit(
          reader.view({
            accounts: {},
            args: [],
            idl: TEST_IDL,
            method: "nonExistentMethod",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(InstructionNotFoundError);
        expect((error as InstructionNotFoundError).method).toBe("nonExistentMethod");
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("returns decoded value for a valid readonly method", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const result = yield* reader.view({
          accounts: { stream: TEST_ADDRESS },
          args: [],
          idl: VIEW_IDL,
          method: "viewValue",
        });

        if (typeof result === "bigint") {
          expect(result).toBe(42n);
          return;
        }

        expect(result).toBeInstanceOf(BN);
        expect((result as BN).toString()).toBe("42");
      }).pipe(Effect.provide(makeTestLayer({ viewReturn: 42n })))
    );

    it.effect("supports simulation responses that include returnData", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const result = yield* reader.view({
          accounts: { stream: TEST_ADDRESS },
          args: [],
          idl: VIEW_IDL,
          method: "viewValue",
        });

        if (typeof result === "bigint") {
          expect(result).toBe(42n);
          return;
        }

        expect(result).toBeInstanceOf(BN);
        expect((result as BN).toString()).toBe("42");
      }).pipe(Effect.provide(makeTestLayer({ includeReturnData: true, viewReturn: 42n })))
    );

    it.effect("returns ViewNotSupportedError for non-view-compatible IDL methods", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const exit = yield* Effect.exit(
          reader.view({
            accounts: { from: TEST_ADDRESS, to: TEST_ADDRESS },
            args: [1n],
            idl: TEST_IDL,
            method: "transfer",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(ViewNotSupportedError);
        expect((error as ViewNotSupportedError).method).toBe("transfer");
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("fails with WalletNotConnectedError when signer unavailable", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const exit = yield* Effect.exit(
          reader.view({
            accounts: { stream: TEST_ADDRESS },
            args: [],
            idl: VIEW_IDL,
            method: "viewValue",
          })
        );

        const error = expectFailError(exit);
        expect(error._tag).toBe("WalletNotConnectedError");
      }).pipe(Effect.provide(makeTestLayer({ disconnected: true })))
    );

    it.effect("returns ProgramReadError when simulation reports an RPC error", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const exit = yield* Effect.exit(
          reader.view({
            accounts: { stream: TEST_ADDRESS },
            args: [],
            idl: VIEW_IDL,
            method: "viewValue",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(ProgramReadError);
        expect((error as ProgramReadError).message).toContain("Failed to read");
      }).pipe(
        Effect.provide(
          makeTestLayer({
            simulationError: { InstructionError: [0, "Custom"] },
          })
        )
      )
    );

    it.effect("formats non-serializable simulation errors without throwing", () => {
      const circularSimulationError: Record<string, unknown> = {};
      circularSimulationError.self = circularSimulationError;

      return Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const exit = yield* Effect.exit(
          reader.view({
            accounts: { stream: TEST_ADDRESS },
            args: [],
            idl: VIEW_IDL,
            method: "viewValue",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(ProgramReadError);

        const readError = error as ProgramReadError;
        expect(readError.cause).toBeInstanceOf(Error);
        expect((readError.cause as Error).message).toContain(
          "View simulation failed: [object Object]"
        );
      }).pipe(
        Effect.provide(
          makeTestLayer({
            simulationError: circularSimulationError,
          })
        )
      );
    });
  });

  describe("viewWithProgram", () => {
    it.effect("returns InstructionNotFoundError for non-existent method", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const program = yield* reader.createProgram({ idl: TEST_IDL });
        const exit = yield* Effect.exit(
          reader.viewWithProgram(program, {
            accounts: {},
            args: [],
            method: "unknownMethod",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(InstructionNotFoundError);
        expect((error as InstructionNotFoundError).method).toBe("unknownMethod");
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("returns WalletNotConnectedError when signer disconnects after createProgram", () => {
      let connected = true;
      const rpcLayer = makeMockRpcServiceLayer({
        getRpc: () => Effect.succeed(makeMockRpc({ viewReturn: 42n })),
      });
      const signerLayer = makeMockSignerServiceLayer({
        getAddress: () =>
          connected
            ? Effect.succeed(TEST_ADDRESS)
            : Effect.fail(new WalletNotConnectedError({ message: "Wallet not connected" })),
      });
      const layer = Layer.provide(ProgramReaderLive, Layer.mergeAll(rpcLayer, signerLayer));

      return Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const program = yield* reader.createProgram({ idl: VIEW_IDL });
        connected = false;

        const exit = yield* Effect.exit(
          reader.viewWithProgram(program, {
            accounts: { stream: TEST_ADDRESS },
            args: [],
            method: "viewValue",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(WalletNotConnectedError);
      }).pipe(Effect.provide(layer));
    });

    it.effect("uses the current signer as fee payer after wallet change", () => {
      let currentAddress: Address = TEST_ADDRESS;
      let observedFeePayer: string | undefined;

      const rpcLayer = makeMockRpcServiceLayer({
        getRpc: () =>
          Effect.succeed(
            makeMockRpc({
              onSimulateTransaction: (wireTransaction) => {
                const tx = Transaction.from(Buffer.from(wireTransaction, "base64"));
                observedFeePayer = tx.feePayer?.toBase58();
              },
              viewReturn: 42n,
            })
          ),
      });
      const signerLayer = makeMockSignerServiceLayer({
        getAddress: () => Effect.succeed(currentAddress),
      });
      const layer = Layer.provide(ProgramReaderLive, Layer.mergeAll(rpcLayer, signerLayer));

      return Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const program = yield* reader.createProgram({ idl: VIEW_IDL });
        currentAddress = ALT_TEST_ADDRESS;

        const result = yield* reader.viewWithProgram(program, {
          accounts: { stream: TEST_ADDRESS },
          args: [],
          method: "viewValue",
        });

        expect(result).toBeDefined();
        expect(observedFeePayer).toBe(ALT_TEST_ADDRESS);
      }).pipe(Effect.provide(layer));
    });

    it.effect("preserves unexpected signer defects in simulate path as defects", () => {
      let addressCalls = 0;
      const rpcLayer = makeMockRpcServiceLayer({
        getRpc: () => Effect.succeed(makeMockRpc({ viewReturn: 42n })),
      });
      const signerLayer = makeMockSignerServiceLayer({
        getAddress: () => {
          addressCalls += 1;
          return addressCalls === 1
            ? Effect.succeed(TEST_ADDRESS)
            : Effect.die(new Error("unexpected signer defect"));
        },
      });
      const layer = Layer.provide(ProgramReaderLive, Layer.mergeAll(rpcLayer, signerLayer));

      return Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const program = yield* reader.createProgram({ idl: VIEW_IDL });

        const exit = yield* Effect.exit(
          reader.viewWithProgram(program, {
            accounts: { stream: TEST_ADDRESS },
            args: [],
            method: "viewValue",
          })
        );

        const defect = expectDieError(exit);
        expect(defect).toBeInstanceOf(Error);
        expect((defect as Error).message).toContain("unexpected signer defect");
      }).pipe(Effect.provide(layer));
    });

    it.effect("returns ViewNotSupportedError when method lacks .view()", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        // Mock a program whose method builder lacks .view()
        const mockProgram = {
          idl: {
            instructions: [
              {
                accounts: [{ name: "stream", signer: false, writable: false }],
                args: [],
                discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
                name: "noView",
                returns: "u64",
              },
            ],
            metadata: { name: "mockProgram" },
          },
          methods: {
            noView: (..._args: unknown[]) => ({
              accountsPartial: () => ({
                /* no .view() */
              }),
            }),
          },
        } as unknown as Program;

        const exit = yield* Effect.exit(
          reader.viewWithProgram(mockProgram, {
            accounts: {},
            args: [],
            method: "noView",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(ViewNotSupportedError);
        expect((error as ViewNotSupportedError).method).toBe("noView");
        expect((error as ViewNotSupportedError).idlName).toBe("mockProgram");
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("returns ProgramReadError when .view() rejects", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const mockProgram = {
          idl: {
            instructions: [
              {
                accounts: [{ name: "stream", signer: false, writable: false }],
                args: [],
                discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
                name: "rejectingView",
                returns: "u64",
              },
            ],
            metadata: { name: "mockProgram" },
          },
          methods: {
            rejectingView: (..._args: unknown[]) => ({
              accountsPartial: () => ({
                view: () => Promise.reject(new Error("boom")),
              }),
            }),
          },
        } as unknown as Program;

        const exit = yield* Effect.exit(
          reader.viewWithProgram(mockProgram, {
            accounts: {},
            args: [],
            method: "rejectingView",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(ProgramReadError);
        expect((error as ProgramReadError).method).toBe("rejectingView");
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("maps Anchor unsupported-view message to ViewNotSupportedError", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const mockProgram = {
          idl: {
            instructions: [
              {
                accounts: [{ name: "stream", signer: false, writable: false }],
                args: [],
                discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
                name: "unsupportedView",
                returns: "u64",
              },
            ],
            metadata: { name: "mockProgram" },
          },
          methods: {
            unsupportedView: (..._args: unknown[]) => ({
              accountsPartial: () => ({
                view: () => Promise.reject(new Error("Method does not support views")),
              }),
            }),
          },
        } as unknown as Program;

        const exit = yield* Effect.exit(
          reader.viewWithProgram(mockProgram, {
            accounts: {},
            args: [],
            method: "unsupportedView",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(ViewNotSupportedError);
        expect((error as ViewNotSupportedError).method).toBe("unsupportedView");
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("returns ViewNotSupportedError for legacy mutable account metadata", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const mockProgram = {
          idl: {
            instructions: [
              {
                accounts: [{ isMut: true, isSigner: false, name: "stream" }],
                args: [],
                discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
                name: "legacyMutableRead",
                returns: "u64",
              },
            ],
            metadata: { name: "legacyProgram" },
          },
          methods: {
            legacyMutableRead: (..._args: unknown[]) => ({
              accountsPartial: () => ({
                view: () => Promise.resolve(42n),
              }),
            }),
          },
        } as unknown as Program;

        const exit = yield* Effect.exit(
          reader.viewWithProgram(mockProgram, {
            accounts: {},
            args: [],
            method: "legacyMutableRead",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(ViewNotSupportedError);
        expect((error as ViewNotSupportedError).method).toBe("legacyMutableRead");
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("returns ViewNotSupportedError for writable nested account groups", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const mockProgram = {
          idl: {
            instructions: [
              {
                accounts: [
                  {
                    accounts: [{ name: "stream", signer: false, writable: true }],
                    name: "group",
                  },
                ],
                args: [],
                discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
                name: "nestedWritableRead",
                returns: "u64",
              },
            ],
            metadata: { name: "nestedProgram" },
          },
          methods: {
            nestedWritableRead: (..._args: unknown[]) => ({
              accountsPartial: () => ({
                view: () => Promise.resolve(42n),
              }),
            }),
          },
        } as unknown as Program;

        const exit = yield* Effect.exit(
          reader.viewWithProgram(mockProgram, {
            accounts: {},
            args: [],
            method: "nestedWritableRead",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(ViewNotSupportedError);
        expect((error as ViewNotSupportedError).method).toBe("nestedWritableRead");
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("logs warning and defers to runtime when IDL method omits returns", () => {
      const logMessages: string[] = [];
      const testLogger = Logger.make(({ message }) => {
        logMessages.push(String(message));
      });

      return Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const mockProgram = {
          idl: {
            instructions: [
              {
                accounts: [{ name: "stream", signer: false, writable: false }],
                args: [],
                discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
                name: "legacyViewWithoutReturns",
              },
            ],
            metadata: { name: "legacyProgram" },
          },
          methods: {
            legacyViewWithoutReturns: (..._args: unknown[]) => ({
              accountsPartial: () => ({
                view: () => Promise.resolve(42n),
              }),
            }),
          },
        } as unknown as Program;

        const result = yield* reader.viewWithProgram(mockProgram, {
          accounts: {},
          args: [],
          method: "legacyViewWithoutReturns",
        });

        expect(result).toBe(42n);
        expect(logMessages.some((message) => message.includes("without IDL return metadata"))).toBe(
          true
        );
      }).pipe(
        Effect.provide(makeTestLayer()),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger))
      );
    });

    it.effect("supports method name normalization between IDL and methods", () =>
      Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const mockProgram = {
          idl: {
            instructions: [
              {
                accounts: [{ name: "stream", signer: false, writable: false }],
                args: [],
                discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
                name: "withdrawable_amount_of",
                returns: "u64",
              },
            ],
            metadata: { name: "mockProgram" },
          },
          methods: {
            withdrawableAmountOf: (..._args: unknown[]) => ({
              accountsPartial: () => ({
                view: () => Promise.resolve(42n),
              }),
            }),
          },
        } as unknown as Program;

        const result = yield* reader.viewWithProgram(mockProgram, {
          accounts: {},
          args: [],
          method: "withdrawableAmountOf",
        });

        expect(result).toBe(42n);
      }).pipe(Effect.provide(makeTestLayer()))
    );

    it.effect("logs warning and still executes when IDL instruction cannot be matched", () => {
      const logMessages: string[] = [];
      const testLogger = Logger.make(({ message }) => {
        logMessages.push(String(message));
      });

      return Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const mockProgram = {
          idl: {
            instructions: [
              {
                accounts: [{ name: "stream", signer: false, writable: false }],
                args: [],
                discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
                name: "legacy_unmatched_instruction_name",
                returns: "u64",
              },
            ],
            metadata: { name: "fallbackProgram" },
          },
          methods: {
            viewValue: (..._args: unknown[]) => ({
              accountsPartial: () => ({
                view: () => Promise.resolve(42n),
              }),
            }),
          },
        } as unknown as Program;

        const result = yield* reader.viewWithProgram(mockProgram, {
          accounts: {},
          args: [],
          method: "viewValue",
        });

        expect(result).toBe(42n);
        expect(
          logMessages.some((message) =>
            message.includes('ProgramReader could not match method "viewValue"')
          )
        ).toBe(true);
      }).pipe(
        Effect.provide(makeTestLayer()),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger))
      );
    });

    it.effect("logs warning and fails when unmatched method builder lacks .view()", () => {
      const logMessages: string[] = [];
      const testLogger = Logger.make(({ message }) => {
        logMessages.push(String(message));
      });

      return Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const mockProgram = {
          idl: {
            instructions: [
              {
                accounts: [{ name: "stream", signer: false, writable: false }],
                args: [],
                discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
                name: "legacy_unmatched_instruction_name",
                returns: "u64",
              },
            ],
            metadata: { name: "fallbackProgram" },
          },
          methods: {
            noViewMethod: (..._args: unknown[]) => ({
              accountsPartial: () => ({}),
            }),
          },
        } as unknown as Program;

        const exit = yield* Effect.exit(
          reader.viewWithProgram(mockProgram, {
            accounts: {},
            args: [],
            method: "noViewMethod",
          })
        );

        const error = expectFailError(exit);
        expect(error).toBeInstanceOf(ViewNotSupportedError);
        expect((error as ViewNotSupportedError).method).toBe("noViewMethod");
        expect(
          logMessages.some((message) =>
            message.includes('ProgramReader could not match method "noViewMethod"')
          )
        ).toBe(true);
      }).pipe(
        Effect.provide(makeTestLayer()),
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger))
      );
    });

    it.effect(
      "logs warning and skips pre-validation when normalized IDL names are ambiguous",
      () => {
        const logMessages: string[] = [];
        const testLogger = Logger.make(({ message }) => {
          logMessages.push(String(message));
        });

        return Effect.gen(function* () {
          const reader = yield* ProgramReader;
          const mockProgram = {
            idl: {
              instructions: [
                {
                  accounts: [{ name: "stream", signer: false, writable: true }],
                  args: [],
                  discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
                  name: "get_amount",
                  returns: "u64",
                },
                {
                  accounts: [{ name: "stream", signer: false, writable: false }],
                  args: [],
                  discriminator: [8, 7, 6, 5, 4, 3, 2, 1],
                  name: "getamount",
                  returns: "u64",
                },
              ],
              metadata: { name: "ambiguousProgram" },
            },
            methods: {
              getAmount: (..._args: unknown[]) => ({
                accountsPartial: () => ({
                  view: () => Promise.resolve(42n),
                }),
              }),
            },
          } as unknown as Program;

          const result = yield* reader.viewWithProgram(mockProgram, {
            accounts: {},
            args: [],
            method: "getAmount",
          });

          expect(result).toBe(42n);
          expect(
            logMessages.some((message) =>
              message.includes("ProgramReader found ambiguous normalized IDL matches")
            )
          ).toBe(true);
        }).pipe(
          Effect.provide(makeTestLayer()),
          Effect.provide(Logger.replace(Logger.defaultLogger, testLogger))
        );
      }
    );

    it.effect("normalizes legacy simulation commitment aliases before RPC", () => {
      const observedCommitments: string[] = [];
      const expectedCommitments = ["processed", "confirmed", "confirmed", "finalized", "finalized"];
      const layer = makeTestLayer({
        onSimulateConfig: (config) => {
          if (
            typeof config === "object" &&
            config !== null &&
            "commitment" in config &&
            typeof config.commitment === "string"
          ) {
            observedCommitments.push(config.commitment);
          }
        },
      });

      return Effect.gen(function* () {
        const reader = yield* ProgramReader;
        const program = yield* reader.createProgram({ idl: VIEW_IDL });
        const provider = program.provider as unknown as {
          readonly simulate: (
            tx: Transaction,
            signers?: readonly unknown[],
            commitment?: string
          ) => Promise<unknown>;
        };

        const aliases = ["recent", "single", "singleGossip", "max", "root"] as const;
        for (const alias of aliases) {
          yield* Effect.promise(() => provider.simulate(makeTestTransaction(), [], alias));
        }

        expect(observedCommitments).toEqual(expectedCommitments);
      }).pipe(Effect.provide(layer));
    });
  });
});
