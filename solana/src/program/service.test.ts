import type { Idl } from "@coral-xyz/anchor";
import { describe, expect, it } from "@effect/vitest";
import type { Address } from "@solana/addresses";
import { Effect, Exit, Layer } from "effect";
import { makeMockRpcServiceLayer } from "#src/testing-kit/index.js";
import {
  InstructionNotFoundError,
  ProgramCreationError,
  ProgramWriter,
  ProgramWriterLive,
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

// Mock RPC that returns minimal data for Program creation
const makeMockRpc = () => ({
  getAccountInfo: () => ({
    send: () => Promise.resolve({ context: { slot: 0n }, value: null }),
  }),
  getLatestBlockhash: () => ({
    send: () =>
      Promise.resolve({
        context: { slot: 0n },
        value: {
          blockhash: "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC",
          lastValidBlockHeight: 1000n,
        },
      }),
  }),
});

describe("ProgramWriter", () => {
  describe("createProgram", () => {
    it.effect("creates a Program instance from valid IDL", () =>
      Effect.gen(function* () {
        const writer = yield* ProgramWriter;
        const program = yield* writer.createProgram({ idl: TEST_IDL });

        expect(program).toBeDefined();
        expect(program.idl.metadata?.name).toBe("testProgram");
      }).pipe(
        Effect.provide(
          Layer.provide(
            ProgramWriterLive,
            makeMockRpcServiceLayer({ getRpc: () => Effect.succeed(makeMockRpc() as never) })
          )
        )
      )
    );

    it.effect("uses programId override when provided", () =>
      Effect.gen(function* () {
        const writer = yield* ProgramWriter;
        const customProgramId = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
        const program = yield* writer.createProgram({
          idl: TEST_IDL,
          programId: customProgramId,
        });

        expect(program).toBeDefined();
      }).pipe(
        Effect.provide(
          Layer.provide(
            ProgramWriterLive,
            makeMockRpcServiceLayer({ getRpc: () => Effect.succeed(makeMockRpc() as never) })
          )
        )
      )
    );

    it.effect("returns ProgramCreationError on invalid IDL", () =>
      Effect.gen(function* () {
        const writer = yield* ProgramWriter;
        const invalidIdl = { invalid: true } as unknown as Idl;
        const exit = yield* Effect.exit(writer.createProgram({ idl: invalidIdl }));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
          expect(exit.cause.error).toBeInstanceOf(ProgramCreationError);
        }
      }).pipe(
        Effect.provide(
          Layer.provide(
            ProgramWriterLive,
            makeMockRpcServiceLayer({ getRpc: () => Effect.succeed(makeMockRpc() as never) })
          )
        )
      )
    );
  });

  describe("buildInstruction", () => {
    it.effect("returns InstructionNotFoundError for non-existent method", () =>
      Effect.gen(function* () {
        const writer = yield* ProgramWriter;
        const program = yield* writer.createProgram({ idl: TEST_IDL });
        const exit = yield* Effect.exit(
          writer.buildInstruction(program, {
            accounts: {},
            args: [],
            method: "nonExistentMethod",
          })
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
          expect(exit.cause.error).toBeInstanceOf(InstructionNotFoundError);
          expect((exit.cause.error as InstructionNotFoundError).method).toBe("nonExistentMethod");
          expect((exit.cause.error as InstructionNotFoundError).idlName).toBe("testProgram");
        }
      }).pipe(
        Effect.provide(
          Layer.provide(
            ProgramWriterLive,
            makeMockRpcServiceLayer({ getRpc: () => Effect.succeed(makeMockRpc() as never) })
          )
        )
      )
    );
  });

  describe("build", () => {
    it.effect("returns InstructionNotFoundError for non-existent method via build", () =>
      Effect.gen(function* () {
        const writer = yield* ProgramWriter;
        const exit = yield* Effect.exit(
          writer.build(TEST_IDL, {
            accounts: {},
            args: [],
            method: "unknownMethod",
          })
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
          expect(exit.cause.error).toBeInstanceOf(InstructionNotFoundError);
        }
      }).pipe(
        Effect.provide(
          Layer.provide(
            ProgramWriterLive,
            makeMockRpcServiceLayer({ getRpc: () => Effect.succeed(makeMockRpc() as never) })
          )
        )
      )
    );
  });
});
