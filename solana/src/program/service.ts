/**
 * ProgramWriter - Effect-based Anchor program interaction service.
 *
 * Wraps @coral-xyz/anchor Program class for clean, type-safe instruction building.
 * This mirrors how ContractWriter works for EVM ABIs.
 *
 * @module program/service
 */

import type { Idl } from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type { Address } from "@solana/addresses";
import type { Instruction } from "@solana/instructions";
import { AccountRole } from "@solana/instructions";
import type { TransactionInstruction } from "@solana/web3.js";
import { Context, Effect, Layer } from "effect";
import { RpcService } from "#src/rpc/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import {
  makeProgramConnectionShim,
  toAnchorAccounts,
  toAnchorArgs,
} from "./internal/anchor-helpers.js";
import type { BuildInstructionParams, CreateProgramParams } from "./types.js";
import { InstructionBuildError, InstructionNotFoundError, ProgramCreationError } from "./types.js";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get account role from signer and writable flags.
 */
function getAccountRole(isSigner: boolean, isWritable: boolean): AccountRole {
  if (isSigner) {
    return isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  }
  return isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
}

/**
 * Convert Anchor TransactionInstruction to Solana kit Instruction format.
 */
function toKitInstruction(anchorIx: TransactionInstruction): Instruction {
  return {
    accounts: anchorIx.keys.map((key) => ({
      address: key.pubkey.toBase58() as Address,
      role: getAccountRole(key.isSigner, key.isWritable),
    })),
    data: new Uint8Array(anchorIx.data),
    programAddress: anchorIx.programId.toBase58() as Address,
  };
}

// =============================================================================
// Service Definition
// =============================================================================

/**
 * Shape of the ProgramWriter for type inference.
 *
 * @category Services
 */
export type ProgramWriterShape = {
  /**
   * Create an Anchor Program instance from an IDL.
   *
   * @param params - Program creation parameters
   * @returns The Anchor Program instance
   */
  readonly createProgram: <T extends Idl>(
    params: CreateProgramParams<T>
  ) => Effect.Effect<Program<T>, ProgramCreationError>;

  /**
   * Build an instruction using Anchor's Program.methods API.
   *
   * This is the cleanest way to build instructions - Anchor handles:
   * - Discriminator generation from method name
   * - Account ordering from IDL
   * - Argument serialization
   * - PDA derivation (for accounts with seeds in IDL)
   *
   * @param program - The Anchor Program instance
   * @param params - Instruction building parameters
   * @returns The built instruction in Solana kit format
   */
  readonly buildInstruction: <T extends Idl>(
    program: Program<T>,
    params: BuildInstructionParams
  ) => Effect.Effect<Instruction, InstructionNotFoundError | InstructionBuildError>;

  /**
   * Build an instruction directly from IDL (creates program internally).
   *
   * Convenience method that combines createProgram + buildInstruction.
   *
   * @param idl - The Anchor IDL
   * @param params - Instruction building parameters
   * @param programId - Optional program ID override
   * @returns The built instruction
   */
  readonly build: <T extends Idl>(
    idl: T,
    params: BuildInstructionParams,
    programId?: Address
  ) => Effect.Effect<
    Instruction,
    ProgramCreationError | InstructionNotFoundError | InstructionBuildError
  >;
};

/**
 * Service tag for program operations (Solana equivalent of ContractWriter).
 *
 * @category Services
 */
export class ProgramWriter extends Context.Tag("esolana/ProgramWriter")<
  ProgramWriter,
  ProgramWriterShape
>() {}

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * Create a ProgramWriter layer.
 *
 * @category Layers
 */
export const ProgramWriterLive = Layer.effect(
  ProgramWriter,
  Effect.gen(function* () {
    const rpcService = yield* RpcService;

    const service: ProgramWriterShape = {
      build: (idl, params, programId) =>
        Effect.gen(function* () {
          const program = yield* service.createProgram({ idl, programId });
          return yield* service.buildInstruction(program, params);
        }).pipe(Effect.withSpan(SpanNames.PROGRAM_BUILD)),

      buildInstruction: (program, params) =>
        Effect.gen(function* () {
          const { method, args, accounts } = params;

          // Check if method exists
          const methodFn = (program.methods as Record<string, unknown>)[method];
          if (!methodFn || typeof methodFn !== "function") {
            return yield* Effect.fail(
              new InstructionNotFoundError({
                idlName: program.idl.metadata?.name ?? "unknown",
                message: `Instruction "${method}" not found in IDL "${program.idl.metadata?.name ?? "unknown"}"`,
                method,
              })
            );
          }

          // Convert args to Anchor format (bigint -> BN)
          const anchorArgs = toAnchorArgs(args);

          // Convert accounts to PublicKeys
          const anchorAccounts = toAnchorAccounts(accounts);

          // Build instruction using Anchor's fluent API
          const builder = (methodFn as (...methodArgs: unknown[]) => unknown)(...anchorArgs);
          const withAccounts = (
            builder as { accountsPartial: (a: unknown) => unknown }
          ).accountsPartial(anchorAccounts);

          const anchorInstruction = yield* Effect.tryPromise({
            catch: (error) =>
              new InstructionBuildError({
                cause: error,
                message: `Failed to build instruction "${method}"`,
                method,
              }),
            try: () =>
              (
                withAccounts as { instruction: () => Promise<TransactionInstruction> }
              ).instruction(),
          });

          // Convert to Solana kit format
          return toKitInstruction(anchorInstruction);
        }).pipe(
          Effect.withSpan(SpanNames.PROGRAM_BUILD_INSTRUCTION, {
            attributes: { method: params.method },
          })
        ),
      createProgram: (params) =>
        Effect.gen(function* () {
          const { idl, programId } = params;

          // Create a minimal provider for Anchor (it just needs the connection for PDAs)
          const rpc = yield* rpcService.getRpc();

          // Build IDL with address override if provided
          const idlWithAddress = programId ? { ...idl, address: programId as string } : idl;

          return yield* Effect.try({
            catch: (error) =>
              new ProgramCreationError({
                cause: error,
                message: "Failed to create Anchor program",
              }),
            try: () =>
              // Create Program with a dummy provider (we're only using it for instruction building)
              // Anchor requires a provider but we only need the IDL parsing
              new Program(
                idlWithAddress as Idl,
                {
                  connection: makeProgramConnectionShim(rpc, "ProgramWriter"),
                } as unknown as Program["provider"]
              ) as unknown as Program<typeof params.idl>,
          });
        }).pipe(Effect.withSpan(SpanNames.PROGRAM_CREATE)),
    };

    return ProgramWriter.of(service);
  })
);
