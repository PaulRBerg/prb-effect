/**
 * ProgramReader - Effect-based Anchor program read service using `.view()`.
 *
 * Provides first-class signer-path `.view()` support for Anchor programs.
 * This is the read counterpart to ProgramWriter (instruction building).
 *
 * `.view()` requires a connected wallet (signer) because Anchor constructs
 * a transaction internally and simulates it on behalf of the signer.
 *
 * @module program/reader
 */

import type { Idl } from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import type {
  Signer as AnchorSigner,
  Commitment,
  Connection,
  PublicKey,
  SimulatedTransactionResponse,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Cause, Context, Effect, Exit, Layer, Option, Runtime } from "effect";
import { WalletNotConnectedError } from "#src/core/errors/index.js";
import { RpcService } from "#src/rpc/index.js";
import { SignerService } from "#src/signer/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import type { Address } from "#src/types/index.js";
import {
  makeProgramConnectionShim,
  toAnchorAccounts,
  toAnchorArgs,
  toPublicKey,
} from "./internal/anchor-helpers.js";
import type { CreateProgramParams, ViewParams } from "./types.js";
import {
  InstructionNotFoundError,
  ProgramCreationError,
  ProgramReadError,
  ViewNotSupportedError,
} from "./types.js";

// =============================================================================
// Helpers
// =============================================================================

function mutateTransactionForSimulation(
  tx: Transaction | VersionedTransaction,
  feePayer: PublicKey,
  blockhash: string,
  signers?: readonly AnchorSigner[]
): void {
  if ("feePayer" in tx) {
    tx.feePayer = feePayer;
  }
  if ("recentBlockhash" in tx) {
    tx.recentBlockhash = blockhash;
  }
  if (signers && signers.length > 0 && "partialSign" in tx) {
    tx.partialSign(...signers);
  }
}

function hasWritableAccounts(accounts: readonly unknown[]): boolean {
  // Support both modern Anchor IDL (`writable`) and legacy IDL (`isMut`) shapes.
  // Nested account groups appear for composite account declarations.
  return accounts.some((account) => {
    if (typeof account !== "object" || account === null) {
      return false;
    }

    if ("accounts" in account && Array.isArray(account.accounts)) {
      return hasWritableAccounts(account.accounts);
    }

    if ("writable" in account && account.writable === true) {
      return true;
    }

    return "isMut" in account && account.isMut === true;
  });
}

function getIdlName<T extends Idl>(program: Program<T>): string {
  return program.idl.metadata?.name ?? "unknown";
}

function resolveProgramIdAttribute(programId?: Address, idlAddress?: unknown): string {
  if (programId) {
    return String(programId);
  }
  if (typeof idlAddress === "string") {
    return idlAddress;
  }
  return "unknown";
}

function makeInstructionNotFoundError(method: string, idlName: string): InstructionNotFoundError {
  return new InstructionNotFoundError({
    idlName,
    message: `Instruction "${method}" not found in IDL "${idlName}"`,
    method,
  });
}

function makeViewNotSupportedError(method: string, idlName: string): ViewNotSupportedError {
  return new ViewNotSupportedError({
    idlName,
    message: `Method "${method}" in IDL "${idlName}" does not support .view()`,
    method,
  });
}

function makeProgramReadError(method: string, cause: unknown): ProgramReadError {
  return new ProgramReadError({
    cause,
    message: `Failed to read "${method}" via .view()`,
    method,
  });
}

class SignerSimulationDefectError extends Error {
  readonly defect: unknown;

  constructor(defect: unknown) {
    super("Signer service defect during ProgramReader simulation");
    this.name = "SignerSimulationDefectError";
    this.defect = defect;
  }
}

function isWalletNotConnectedError(error: unknown): error is WalletNotConnectedError {
  return (
    (typeof error === "object" &&
      error !== null &&
      (error as { readonly _tag?: unknown })._tag === "WalletNotConnectedError") ||
    error instanceof WalletNotConnectedError
  );
}

function getTransactionBlockhash(tx: Transaction | VersionedTransaction): string | undefined {
  // Supports @solana/web3.js 1.95.x transaction shapes used by Anchor 0.31.x.
  // Re-check these guards if web3.js changes message/blockhash field layouts.
  if (
    "recentBlockhash" in tx &&
    typeof tx.recentBlockhash === "string" &&
    tx.recentBlockhash.length > 0
  ) {
    return tx.recentBlockhash;
  }

  if (
    "message" in tx &&
    typeof (
      tx as {
        readonly message?: { readonly recentBlockhash?: unknown };
      }
    ).message?.recentBlockhash === "string"
  ) {
    return (
      tx as {
        readonly message: { readonly recentBlockhash: string };
      }
    ).message.recentBlockhash;
  }

  return undefined;
}

function formatSimulationError(error: unknown): string {
  const MAX_ERROR_MESSAGE_LENGTH = 500;

  if (typeof error === "string") {
    return error.slice(0, MAX_ERROR_MESSAGE_LENGTH);
  }

  if (error instanceof Error) {
    return error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
  }

  try {
    return JSON.stringify(error, null, 2).slice(0, MAX_ERROR_MESSAGE_LENGTH);
  } catch {
    return String(error).slice(0, MAX_ERROR_MESSAGE_LENGTH);
  }
}

function normalizeSimulationCommitment(commitment?: string): Commitment | undefined {
  if (!commitment) {
    return undefined;
  }

  switch (commitment) {
    case "processed":
    case "confirmed":
    case "finalized":
      return commitment;
    case "recent":
      return "processed";
    case "single":
    case "singleGossip":
      return "confirmed";
    case "max":
    case "root":
      return "finalized";
    default:
      return undefined;
  }
}

async function simulateTransaction(
  connection: Connection,
  tx: Transaction | VersionedTransaction,
  commitment?: Commitment
): Promise<Omit<SimulatedTransactionResponse, "err">> {
  const simulation =
    "version" in tx
      ? await connection.simulateTransaction(tx, {
          ...(commitment ? { commitment } : {}),
          sigVerify: false,
        })
      : await connection.simulateTransaction(tx);

  if (simulation.value.err) {
    throw new Error(`View simulation failed: ${formatSimulationError(simulation.value.err)}`, {
      cause: simulation.value.err,
    });
  }

  const { err: _err, ...response } = simulation.value;
  return response;
}

function normalizeMethodName(name: string): string {
  // Keep normalization intentionally simple for snake_case vs camelCase IDL/method parity.
  // Normalization may produce collisions; ambiguity is handled by skipping pre-validation.
  return name.replaceAll("_", "").toLowerCase();
}

function resolveViewBuilder<T extends Idl>(
  program: Program<T>,
  params: Pick<ViewParams, "method" | "args" | "accounts">
): Effect.Effect<
  { view: () => Promise<unknown> },
  InstructionNotFoundError | ViewNotSupportedError
> {
  return Effect.gen(function* () {
    const { method, args, accounts } = params;
    const idlName = getIdlName(program);

    const methodFn = (program.methods as Record<string, unknown>)[method];
    if (!methodFn || typeof methodFn !== "function") {
      return yield* Effect.fail(makeInstructionNotFoundError(method, idlName));
    }

    const normalizedMethod = normalizeMethodName(method);
    const exactInstruction = program.idl.instructions.find(
      (instruction) => instruction.name === method
    );
    const normalizedMatches = program.idl.instructions.filter(
      (instruction) => normalizeMethodName(instruction.name) === normalizedMethod
    );
    const idlInstruction =
      exactInstruction ?? (normalizedMatches.length === 1 ? normalizedMatches[0] : undefined);

    // Keep pre-validation when we can confidently match an IDL instruction.
    // If no match is found, defer to Anchor's runtime .view() support checks.
    if (idlInstruction) {
      const hasWritableAccount = hasWritableAccounts(idlInstruction.accounts);
      const hasReturnType = Boolean(idlInstruction.returns);
      if (hasWritableAccount) {
        return yield* Effect.fail(makeViewNotSupportedError(method, idlName));
      }
      if (!hasReturnType) {
        yield* Effect.logWarning(
          `ProgramReader found instruction "${idlInstruction.name}" in "${idlName}" without IDL return metadata. Skipping return-type pre-validation and deferring to Anchor runtime.`
        );
      }
    } else if (normalizedMatches.length > 1) {
      yield* Effect.logWarning(
        `ProgramReader found ambiguous normalized IDL matches for method "${method}" in "${idlName}". Skipping pre-validation and deferring to Anchor runtime.`
      );
    } else {
      yield* Effect.logWarning(
        `ProgramReader could not match method "${method}" to an IDL instruction in "${idlName}". Skipping pre-validation and deferring to Anchor runtime.`
      );
    }

    const anchorArgs = toAnchorArgs(args);
    const anchorAccounts = toAnchorAccounts(accounts);
    const builder = (methodFn as (...methodArgs: unknown[]) => unknown)(...anchorArgs);
    const withAccounts = (builder as { accountsPartial: (a: unknown) => unknown }).accountsPartial(
      anchorAccounts
    );

    if (!withAccounts || typeof (withAccounts as { view?: unknown }).view !== "function") {
      return yield* Effect.fail(makeViewNotSupportedError(method, idlName));
    }

    return withAccounts as { view: () => Promise<unknown> };
  });
}

// =============================================================================
// Service Definition
// =============================================================================

/**
 * Shape of the ProgramReader for type inference.
 *
 * @category Services
 */
export type ProgramReaderShape = {
  /**
   * Create an Anchor Program instance with a signer-backed provider.
   *
   * Unlike ProgramWriter's createProgram (which uses a minimal connection-only provider),
   * this creates a provider with wallet capabilities required for `.view()`.
   */
  readonly createProgram: <T extends Idl>(
    params: CreateProgramParams<T>
  ) => Effect.Effect<Program<T>, ProgramCreationError | WalletNotConnectedError>;

  /**
   * Call `.view()` on an Anchor program method.
   *
   * Requires a connected wallet — Anchor uses the signer's publicKey
   * as the payer for the simulated transaction.
   */
  readonly view: (
    params: ViewParams
  ) => Effect.Effect<
    unknown,
    | ProgramCreationError
    | InstructionNotFoundError
    | ViewNotSupportedError
    | ProgramReadError
    | WalletNotConnectedError
  >;

  /**
   * Call `.view()` on a pre-created Program instance.
   *
   * Useful for batched reads where the program is already constructed.
   */
  readonly viewWithProgram: <T extends Idl>(
    program: Program<T>,
    params: Pick<ViewParams, "method" | "args" | "accounts">
  ) => Effect.Effect<
    unknown,
    InstructionNotFoundError | ViewNotSupportedError | ProgramReadError | WalletNotConnectedError
  >;
};

/**
 * Service tag for program read operations.
 *
 * @category Services
 */
export class ProgramReader extends Context.Tag("esolana/ProgramReader")<
  ProgramReader,
  ProgramReaderShape
>() {}

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * Create a ProgramReader layer.
 *
 * Requires RpcService (connection) and SignerService (wallet) to construct
 * Anchor providers that support `.view()`.
 *
 * @category Layers
 */
export const ProgramReaderLive = Layer.effect(
  ProgramReader,
  Effect.gen(function* () {
    const rpcService = yield* RpcService;
    const signerService = yield* SignerService;
    const runtime = yield* Effect.runtime();

    const service: ProgramReaderShape = {
      createProgram: (params) =>
        Effect.gen(function* () {
          const { idl, programId } = params;

          const rpc = yield* rpcService.getRpc();
          const initialWalletAddress = yield* signerService.getAddress();
          const resolveSimulationFeePayer = async (): Promise<PublicKey> => {
            // Anchor invokes provider.simulate outside Effect. Use the captured runtime
            // so logger/tracer configuration remains consistent with this layer.
            const exit = await Runtime.runPromiseExit(runtime, signerService.getAddress());
            if (Exit.isSuccess(exit)) {
              return toPublicKey(exit.value);
            }

            const failure = Cause.failureOption(exit.cause);
            if (Option.isSome(failure)) {
              throw failure.value;
            }

            throw new SignerSimulationDefectError(Cause.squash(exit.cause));
          };

          const idlWithAddress = programId ? { ...idl, address: programId as string } : idl;

          return yield* Effect.try({
            catch: (error) =>
              new ProgramCreationError({
                cause: error,
                message: "Failed to create Anchor program",
              }),
            try: () =>
              new Program(
                idlWithAddress as Idl,
                {
                  connection: makeProgramConnectionShim(rpc, "ProgramReader"),
                  // Observed on @coral-xyz/anchor 0.31.x: provider.publicKey is read when
                  // constructing simulation transactions, and this value is captured at
                  // Program creation time. We intentionally keep this static and refresh the
                  // effective fee payer in `simulate` for wallet-switch safety, so the two
                  // addresses can diverge by design.
                  publicKey: toPublicKey(initialWalletAddress),
                  simulate: async (
                    tx: Transaction | VersionedTransaction,
                    signers?: readonly AnchorSigner[],
                    commitment?: string
                  ): Promise<Omit<SimulatedTransactionResponse, "err">> => {
                    // Resolve the signer lazily on each simulation to avoid stale
                    // fee payer when a pre-created Program is reused across wallet changes.
                    const feePayer = await resolveSimulationFeePayer();
                    const transactionBlockhash =
                      getTransactionBlockhash(tx) ?? (await rpc.getLatestBlockhash()).blockhash;
                    mutateTransactionForSimulation(tx, feePayer, transactionBlockhash, signers);

                    const normalizedCommitment = normalizeSimulationCommitment(commitment);
                    return simulateTransaction(rpc, tx, normalizedCommitment);
                  },
                } as unknown as Program["provider"]
              ) as unknown as Program<typeof params.idl>,
          });
        }).pipe(
          Effect.withSpan(SpanNames.PROGRAM_CREATE_FOR_READ, {
            attributes: {
              programId: resolveProgramIdAttribute(params.programId, params.idl.address),
            },
          })
        ),

      view: (params) =>
        Effect.gen(function* () {
          const { idl, method, args, accounts, programId } = params;
          const program = yield* service.createProgram({ idl, programId });
          return yield* service.viewWithProgram(program, { accounts, args, method });
        }).pipe(
          Effect.withSpan(SpanNames.PROGRAM_VIEW, {
            attributes: {
              method: params.method,
              programId: resolveProgramIdAttribute(params.programId, params.idl.address),
            },
          })
        ),

      viewWithProgram: (program, params) =>
        Effect.gen(function* () {
          const { method } = params;
          const idlName = getIdlName(program);
          const withAccounts = yield* resolveViewBuilder(program, params);

          return yield* Effect.tryPromise({
            catch: (error) => {
              if (error instanceof SignerSimulationDefectError) {
                throw error.defect;
              }
              if (isWalletNotConnectedError(error)) {
                return error;
              }
              // Anchor currently surfaces this as an untyped Error message (observed on 0.31.x).
              // Re-validate this guard if Anchor changes .view() failure message semantics.
              if (
                error instanceof Error &&
                error.message.includes("Method does not support views")
              ) {
                return makeViewNotSupportedError(method, idlName);
              }
              return makeProgramReadError(method, error);
            },
            try: () => withAccounts.view(),
          });
        }).pipe(
          Effect.withSpan(SpanNames.PROGRAM_VIEW_WITH_PROGRAM, {
            attributes: {
              method: params.method,
              programId: resolveProgramIdAttribute(undefined, program.idl.address),
            },
          })
        ),
    };

    return ProgramReader.of(service);
  })
);
