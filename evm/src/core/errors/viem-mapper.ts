import type { Address, Hash } from "viem";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  BaseError as CoreError,
  TransactionExecutionError,
  UserRejectedRequestError,
  InsufficientFundsError as ViemInsufficientFundsError,
} from "viem";
import {
  ContractReadError,
  ContractWriteError,
  GasEstimationError,
  SimulationFailedError,
} from "#src/core/errors/contract.js";
import {
  decodeExecutionFailure,
  executionFailureReason,
} from "#src/core/errors/execution-failure.js";
import {
  InsufficientFundsError,
  isLikelyUserRejectedError,
  ResourceExhaustionError,
  UserRejectedError,
} from "#src/core/errors/tx.js";
import {
  AddChainError,
  ChainSwitchError,
  SignMessageError,
  SignTxError,
  SignTypedDataError,
  WalletConnectionError,
  WatchAssetError,
} from "#src/wallet/index.js";

const TX_HASH_RE = /0x[a-fA-F0-9]{64}/;
const ERROR_MESSAGE_FIELDS = ["message", "shortMessage", "details"] as const;
const NONCE_TOO_LOW_RE = /nonce (?:is )?too low|nonce has already been used|already used nonce/i;
const NONCE_TOO_LOW_FALSE_POSITIVE_RE =
  /account nonce too high|replacement transaction underpriced|transaction underpriced|already known/i;

type TransactionErrorContext = {
  address: Address;
  calldata?: string;
  functionName: string;
  sender?: string;
  value?: string;
};

/**
 * Check if an error represents a user rejection (wallet user denied the request)
 */
export function isUserRejection(error: unknown): boolean {
  return isLikelyUserRejectedError(error) || error instanceof UserRejectedRequestError;
}

/**
 * Check if an error represents insufficient funds
 */
export function isInsufficientFunds(error: unknown): boolean {
  if (error instanceof ViemInsufficientFundsError) {
    return true;
  }

  // Fallback: check error message
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("insufficient funds") ||
      message.includes("insufficient balance") ||
      message.includes("exceeds balance")
    );
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function messageMatchesNonceTooLow(message: string): boolean {
  return NONCE_TOO_LOW_RE.test(message) && !NONCE_TOO_LOW_FALSE_POSITIVE_RE.test(message);
}

function hasDirectNonceTooLowMessage(error: unknown): boolean {
  if (typeof error === "string") {
    return messageMatchesNonceTooLow(error);
  }

  if (!isRecord(error)) {
    return false;
  }

  return ERROR_MESSAGE_FIELDS.some((field) => {
    const value = error[field];
    return typeof value === "string" && messageMatchesNonceTooLow(value);
  });
}

/**
 * Check if an error represents a nonce that is below the wallet/provider floor.
 * Walks both viem BaseError chains and plain Error.cause wrappers.
 */
export function isNonceTooLowError(error: unknown): boolean {
  const seen = new WeakSet<object>();

  const visit = (value: unknown): boolean => {
    if (hasDirectNonceTooLowMessage(value)) {
      return true;
    }

    if (!isRecord(value)) {
      return false;
    }

    if (seen.has(value)) {
      return false;
    }
    seen.add(value);

    if (value instanceof CoreError && value.walk(hasDirectNonceTooLowMessage) !== null) {
      return true;
    }

    return visit(value.cause);
  };

  return visit(error);
}

const RESOURCE_EXHAUSTION_RE = /cannot allocate memory|ENOMEM|out of memory/i;

/**
 * Check if an error represents device/environment resource exhaustion.
 * Walks the viem error cause chain to find the underlying OS-level error.
 */
export function isResourceExhaustion(error: unknown): boolean {
  if (error instanceof CoreError) {
    const deepest = error.walk();
    if (deepest instanceof Error && RESOURCE_EXHAUSTION_RE.test(deepest.message)) {
      return true;
    }
    // Also check the top-level details field (BaseError.details is string)
    if (typeof error.details === "string" && RESOURCE_EXHAUSTION_RE.test(error.details)) {
      return true;
    }
  }

  if (error instanceof Error) {
    return RESOURCE_EXHAUSTION_RE.test(error.message);
  }

  if (typeof error === "string") {
    return RESOURCE_EXHAUSTION_RE.test(error);
  }

  return false;
}

export function extractRevertReason(error: unknown): string | undefined {
  return executionFailureReason(decodeExecutionFailure(error, "simulate"));
}

/**
 * Check if an error represents a transaction replacement
 * Returns replacement info if replaced, false otherwise
 */
export function isTxReplaced(error: unknown): { newHash: Hash; replaced: true } | false {
  const byExecutionError =
    error instanceof TransactionExecutionError
      ? getReplacementHashFromExecutionError(error)
      : undefined;
  if (byExecutionError) {
    return { newHash: byExecutionError, replaced: true };
  }

  const byMessage =
    error instanceof Error ? getReplacementHashFromMessage(error.message) : undefined;
  if (byMessage) {
    return { newHash: byMessage, replaced: true };
  }

  return false;
}

function getReplacementHashFromExecutionError(error: TransactionExecutionError): Hash | undefined {
  const cause = error.cause;
  if (!cause || typeof cause !== "object") {
    return;
  }

  if (!("name" in cause) || cause.name !== "TransactionNotFoundError") {
    return;
  }

  const details = (cause as { details?: string }).details;
  if (!details) {
    return;
  }

  const hashMatch = details.match(TX_HASH_RE);
  return hashMatch?.[0] ? (hashMatch[0] as Hash) : undefined;
}

function getReplacementHashFromMessage(message: string): Hash | undefined {
  if (!(message.includes("replaced") || message.includes("repriced"))) {
    return;
  }

  const hashes = message.match(/0x[a-fA-F0-9]{64}/g);
  if (!hashes || hashes.length === 0) {
    return;
  }

  return (hashes.length >= 2 ? hashes[1] : hashes[0]) as Hash;
}

/**
 * Classify contract read/simulation errors into specific error types
 */
export function classifyContractError(
  error: unknown,
  context: TransactionErrorContext
):
  | ContractReadError
  | SimulationFailedError
  | InsufficientFundsError
  | ResourceExhaustionError
  | UserRejectedError {
  // Check for user rejection first
  if (isUserRejection(error)) {
    return new UserRejectedError({
      message: error instanceof Error ? error.message : "User rejected the request",
    });
  }

  // Check for insufficient funds
  if (isInsufficientFunds(error)) {
    return new InsufficientFundsError({
      message: error instanceof Error ? error.message : "Insufficient funds",
    });
  }

  // Check for device/environment resource exhaustion
  if (isResourceExhaustion(error)) {
    return new ResourceExhaustionError({
      cause: error,
      message: "Device ran out of memory during contract read",
    });
  }

  // Check for contract function execution errors (reverts)
  const executionFailure = decodeExecutionFailure(error, "simulate");
  if (
    error instanceof ContractFunctionExecutionError ||
    error instanceof ContractFunctionRevertedError ||
    executionFailure
  ) {
    const resolvedExecutionFailure = executionFailure ?? ({ phase: "simulate" } as const);
    const reason = executionFailureReason(resolvedExecutionFailure);

    return new SimulationFailedError({
      address: context.address,
      calldata: context.calldata,
      customErrorName: resolvedExecutionFailure.customErrorName,
      functionName: context.functionName,
      message: `Failed to simulate ${context.functionName} on ${context.address}${reason ? `: ${reason}` : ""}`,
      phase: "simulate",
      revertData: resolvedExecutionFailure.revertData,
      revertReason: resolvedExecutionFailure.revertReason,
      sender: context.sender,
      value: context.value,
    });
  }

  // Default: return generic contract read error
  return new ContractReadError({
    address: context.address,
    cause: error,
    functionName: context.functionName,
    message: `Failed to read ${context.functionName} from ${context.address}`,
  });
}

/**
 * Classify contract write errors into specific error types
 */
export function classifyWriteError(
  error: unknown,
  context: TransactionErrorContext
): ContractWriteError | InsufficientFundsError | ResourceExhaustionError | UserRejectedError {
  // Check for user rejection first
  if (isUserRejection(error)) {
    return new UserRejectedError({
      message: error instanceof Error ? error.message : "User rejected the transaction",
    });
  }

  // Check for insufficient funds
  if (isInsufficientFunds(error)) {
    return new InsufficientFundsError({
      message: error instanceof Error ? error.message : "Insufficient funds for transaction",
    });
  }

  // Check for device/environment resource exhaustion
  if (isResourceExhaustion(error)) {
    return new ResourceExhaustionError({
      cause: error,
      message: "Device ran out of memory during transaction submission",
    });
  }

  // Default: return generic contract write error
  return new ContractWriteError({
    address: context.address,
    calldata: context.calldata,
    cause: error,
    functionName: context.functionName,
    message: `Failed to write ${context.functionName} to ${context.address}`,
    sender: context.sender,
    value: context.value,
  });
}

/**
 * Classify gas estimation errors into specific error types
 */
export function classifyGasEstimationError(
  error: unknown,
  context: TransactionErrorContext
): GasEstimationError | InsufficientFundsError | ResourceExhaustionError | UserRejectedError {
  // Check for user rejection
  if (isUserRejection(error)) {
    return new UserRejectedError({
      message: error instanceof Error ? error.message : "User rejected the request",
    });
  }

  // Check for insufficient funds
  if (isInsufficientFunds(error)) {
    return new InsufficientFundsError({
      message: error instanceof Error ? error.message : "Insufficient funds for gas estimation",
    });
  }

  // Check for device/environment resource exhaustion
  if (isResourceExhaustion(error)) {
    return new ResourceExhaustionError({
      cause: error,
      message: "Device ran out of memory during gas estimation",
    });
  }

  const executionFailure =
    decodeExecutionFailure(error, "estimate") ?? ({ phase: "estimate" } as const);
  const reason = executionFailureReason(executionFailure);

  // Default: return generic gas estimation error
  return new GasEstimationError({
    address: context.address,
    calldata: context.calldata,
    cause: error,
    customErrorName: executionFailure.customErrorName,
    functionName: context.functionName,
    message: `Failed to estimate gas for ${context.functionName} on ${context.address}${reason ? `: ${reason}` : ""}`,
    phase: "estimate",
    revertData: executionFailure.revertData,
    revertReason: executionFailure.revertReason,
    sender: context.sender,
    value: context.value,
  });
}

/**
 * Classify wallet operation errors into specific error types
 */
export function classifyWalletError(
  error: unknown,
  operation: "connect",
  context?: { chainId?: number }
): UserRejectedError | WalletConnectionError;
export function classifyWalletError(
  error: unknown,
  operation: "switchChain",
  context?: { chainId?: number }
): UserRejectedError | ChainSwitchError;
export function classifyWalletError(
  error: unknown,
  operation: "addChain",
  context?: { chainId?: number }
): UserRejectedError | AddChainError;
export function classifyWalletError(
  error: unknown,
  operation: "signMessage",
  context?: { chainId?: number }
): UserRejectedError | SignMessageError;
export function classifyWalletError(
  error: unknown,
  operation: "signTypedData",
  context?: { chainId?: number }
): UserRejectedError | SignTypedDataError;
export function classifyWalletError(
  error: unknown,
  operation: "signTransaction",
  context?: { chainId?: number }
): UserRejectedError | SignTxError;
export function classifyWalletError(
  error: unknown,
  operation: "watchAsset",
  context?: { chainId?: number }
): UserRejectedError | WatchAssetError;
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: switch statement complexity is inherent to operation classification
export function classifyWalletError(
  error: unknown,
  operation:
    | "connect"
    | "switchChain"
    | "addChain"
    | "signMessage"
    | "signTypedData"
    | "signTransaction"
    | "watchAsset",
  context?: { chainId?: number }
):
  | UserRejectedError
  | WalletConnectionError
  | ChainSwitchError
  | AddChainError
  | SignMessageError
  | SignTypedDataError
  | SignTxError
  | WatchAssetError {
  // Check for user rejection first
  if (isUserRejection(error)) {
    return new UserRejectedError({
      message: error instanceof Error ? error.message : "User rejected the request",
    });
  }

  // Return operation-specific error
  switch (operation) {
    case "connect":
      return new WalletConnectionError({
        cause: error,
        message: error instanceof Error ? error.message : "Failed to connect wallet",
      });

    case "switchChain":
      return new ChainSwitchError({
        cause: error,
        chainId: context?.chainId ?? 0,
        message:
          error instanceof Error
            ? error.message
            : `Failed to switch to chain ${context?.chainId ?? "unknown"}`,
      });

    case "addChain":
      return new AddChainError({
        cause: error,
        chainId: context?.chainId ?? 0,
        message:
          error instanceof Error
            ? error.message
            : `Failed to add chain ${context?.chainId ?? "unknown"}`,
      });

    case "signMessage":
      return new SignMessageError({
        cause: error,
        message: error instanceof Error ? error.message : "Failed to sign message",
      });

    case "signTypedData":
      return new SignTypedDataError({
        cause: error,
        message: error instanceof Error ? error.message : "Failed to sign typed data",
      });

    case "signTransaction":
      return new SignTxError({
        cause: error,
        message: error instanceof Error ? error.message : "Failed to sign transaction",
      });

    case "watchAsset":
      return new WatchAssetError({
        cause: error,
        message: error instanceof Error ? error.message : "Failed to watch asset",
      });
    default: {
      const _exhaustive: never = operation;
      return new WalletConnectionError({
        cause: error,
        message: `Unhandled wallet operation: ${_exhaustive}`,
      });
    }
  }
}
