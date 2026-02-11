/**
 * Type definitions for Anchor program interactions.
 *
 * Provides TypeScript types for IDL-based instruction building using @coral-xyz/anchor.
 *
 * @module program/types
 */

import type { Address } from "@solana/addresses";
import type { Instruction } from "@solana/instructions";
import { Schema } from "effect";

// =============================================================================
// Re-exports from Anchor
// =============================================================================

export type { Idl, Program } from "@coral-xyz/anchor";

// =============================================================================
// Program Service Types
// =============================================================================

/**
 * Account configuration for instruction building.
 * Maps account names to addresses.
 */
export type AccountsMap = Record<string, Address | string>;

/**
 * Parameters for creating a Program instance.
 */
export type CreateProgramParams<
  T extends import("@coral-xyz/anchor").Idl = import("@coral-xyz/anchor").Idl,
> = {
  /** The Anchor IDL */
  readonly idl: T;
  /** Override the program address from IDL */
  readonly programId?: Address;
};

/**
 * Parameters for building an instruction.
 */
export type BuildInstructionParams<TArgs extends readonly unknown[] = readonly unknown[]> = {
  /** The method/instruction name */
  readonly method: string;
  /** Instruction arguments in order */
  readonly args: TArgs;
  /** Account addresses mapped by name (only non-PDA, non-fixed accounts) */
  readonly accounts: AccountsMap;
};

/**
 * Result of building an instruction.
 */
export type BuildInstructionResult = {
  /** The built instruction (Solana kit format) */
  readonly instruction: Instruction;
};

// =============================================================================
// Program Reader Types
// =============================================================================

/**
 * Parameters for calling `.view()` on an Anchor program method.
 */
export type ViewParams<TArgs extends readonly unknown[] = readonly unknown[]> = {
  /** The Anchor IDL */
  readonly idl: import("@coral-xyz/anchor").Idl;
  /** The method/instruction name to call via `.view()` */
  readonly method: string;
  /** Method arguments in order */
  readonly args: TArgs;
  /** Account addresses mapped by name */
  readonly accounts: AccountsMap;
  /** Override the program address from IDL */
  readonly programId?: Address;
};

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error thrown when an instruction method is not found in the IDL.
 */
export class InstructionNotFoundError extends Schema.TaggedError<InstructionNotFoundError>()(
  "InstructionNotFoundError",
  {
    idlName: Schema.String,
    message: Schema.String,
    method: Schema.String,
  }
) {}

/**
 * Error thrown when program creation fails.
 */
export class ProgramCreationError extends Schema.TaggedError<ProgramCreationError>()(
  "ProgramCreationError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
  }
) {}

/**
 * Error thrown when instruction building fails.
 */
export class InstructionBuildError extends Schema.TaggedError<InstructionBuildError>()(
  "InstructionBuildError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
    method: Schema.String,
  }
) {}

/**
 * Error thrown when a `.view()` call fails.
 */
export class ProgramReadError extends Schema.TaggedError<ProgramReadError>()("ProgramReadError", {
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
  method: Schema.String,
}) {}

/**
 * Error thrown when a method is not compatible with `.view()` semantics.
 */
export class ViewNotSupportedError extends Schema.TaggedError<ViewNotSupportedError>()(
  "ViewNotSupportedError",
  {
    idlName: Schema.String,
    message: Schema.String,
    method: Schema.String,
  }
) {}
