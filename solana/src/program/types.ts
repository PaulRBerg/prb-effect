/**
 * Type definitions for Anchor program interactions.
 *
 * Provides TypeScript types for IDL-based instruction building using @coral-xyz/anchor.
 *
 * @module program/types
 */

import type { Address } from "@solana/addresses";
import type { Instruction } from "@solana/instructions";

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
// Error Types
// =============================================================================

/**
 * Error thrown when an instruction method is not found in the IDL.
 */
export class InstructionNotFoundError extends Error {
  readonly _tag = "InstructionNotFoundError";
  readonly method: string;
  readonly idlName: string;

  constructor(method: string, idlName: string) {
    super(`Instruction "${method}" not found in IDL "${idlName}"`);
    this.name = "InstructionNotFoundError";
    this.method = method;
    this.idlName = idlName;
  }
}

/**
 * Error thrown when program creation fails.
 */
export class ProgramCreationError extends Error {
  readonly _tag = "ProgramCreationError";
  override readonly cause: unknown;

  constructor(cause: unknown, message?: string) {
    super(message ?? "Failed to create Anchor program");
    this.name = "ProgramCreationError";
    this.cause = cause;
  }
}

/**
 * Error thrown when instruction building fails.
 */
export class InstructionBuildError extends Error {
  readonly _tag = "InstructionBuildError";
  readonly method: string;
  override readonly cause: unknown;

  constructor(method: string, cause: unknown) {
    super(`Failed to build instruction "${method}"`);
    this.name = "InstructionBuildError";
    this.method = method;
    this.cause = cause;
  }
}
