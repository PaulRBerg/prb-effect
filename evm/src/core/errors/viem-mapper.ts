import type { Address, Hash } from "viem";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  BaseError as CoreError,
  EstimateGasExecutionError,
  TransactionExecutionError,
  UserRejectedRequestError,
  InsufficientFundsError as ViemInsufficientFundsError,
} from "viem";
import {
  ContractReadError,
  ContractWriteError,
  GasEstimationError,
  SimulationFailedError,
} from "@/src/core/errors/contract.js";
import {
  InsufficientFundsError,
  isLikelyUserRejectedError,
  UserRejectedError,
} from "@/src/core/errors/transaction.js";
import {
  AddChainError,
  ChainSwitchError,
  SignMessageError,
  SignTransactionError,
  SignTypedDataError,
  WalletConnectionError,
  WatchAssetError,
} from "@/src/wallet/index.js";

const REVERT_REASON_RE = /reverted with reason: (.+?)(?:\n|$)/;
const REVERT_REASON_STRING_RE = /reverted with reason string '(.+?)'/;
const REVERT_CUSTOM_ERROR_RE = /reverted with custom error '(.+?)'/;
const EXECUTION_REVERTED_RE = /execution reverted(?::?\s*)(.+?)(?:\n|$)/i;
const EXECUTION_REVERTED_GENERIC_RE = /execution reverted/i;
const TX_HASH_RE = /0x[a-fA-F0-9]{64}/;

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

/**
 * Extract revert reason from Viem errors using walk() to traverse the error chain.
 * See: https://github.com/wevm/viem/discussions/3519
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: error extraction requires multiple conditional branches for different error types
export function extractRevertReason(error: unknown): string | undefined {
  // Use walk() to traverse to the deepest error in the chain (undocumented but reliable)
  // This handles nested error structures like ContractFunctionExecutionError wrapping ContractFunctionRevertedError
  if (error instanceof CoreError) {
    // First try to find a ContractFunctionRevertedError in the chain
    const revertError = error.walk(
      (e) => e instanceof ContractFunctionRevertedError
    ) as ContractFunctionRevertedError | null;

    if (revertError) {
      // Try reason property (decoded string revert)
      if (revertError.reason) {
        return revertError.reason;
      }
      // Try data.errorName for custom errors
      if (revertError.data?.errorName) {
        return revertError.data.errorName;
      }
      // Try shortMessage which often contains the revert reason
      if (revertError.shortMessage) {
        const match = revertError.shortMessage.match(EXECUTION_REVERTED_RE);
        if (match?.[1]) {
          return match[1].trim();
        }
        return revertError.shortMessage;
      }
    }

    // Fall back to the deepest error's shortMessage
    const deepestError = error.walk();
    if (deepestError instanceof CoreError && deepestError.shortMessage) {
      const match = deepestError.shortMessage.match(EXECUTION_REVERTED_RE);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
  }

  // Fall back to regex matching on message
  if (error instanceof Error) {
    // Try "reason string '...'" format (e.g., "Transaction reverted with reason string 'Insufficient allowance'")
    const reasonStringMatch = error.message.match(REVERT_REASON_STRING_RE);
    if (reasonStringMatch?.[1]) {
      return reasonStringMatch[1];
    }

    // Try Viem's "execution reverted:" format with a reason
    const execMatch = error.message.match(EXECUTION_REVERTED_RE);
    if (execMatch?.[1]) {
      return execMatch[1].trim();
    }

    // Try legacy formats
    const revertMatch = error.message.match(REVERT_REASON_RE);
    if (revertMatch?.[1]) {
      return revertMatch[1];
    }

    const customMatch = error.message.match(REVERT_CUSTOM_ERROR_RE);
    if (customMatch?.[1]) {
      return customMatch[1];
    }

    // Check for generic "execution reverted" without specific reason
    if (EXECUTION_REVERTED_GENERIC_RE.test(error.message)) {
      return "execution reverted";
    }
  }

  return undefined;
}

/**
 * Check if an error represents a transaction replacement
 * Returns replacement info if replaced, false otherwise
 */
export function isTransactionReplaced(error: unknown): { newHash: Hash; replaced: true } | false {
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
  context: { address: Address; functionName: string }
): ContractReadError | SimulationFailedError | InsufficientFundsError | UserRejectedError {
  // Check for user rejection first
  if (isUserRejection(error)) {
    return new UserRejectedError({
      message: error instanceof Error ? error.message : "User rejected the request",
    });
  }

  // Check for insufficient funds
  if (isInsufficientFunds(error)) {
    return new InsufficientFundsError({
      available: "0", // We don't have this info in the error
      message: error instanceof Error ? error.message : "Insufficient funds",
      required: "0", // We don't have this info in the error
    });
  }

  // Check for contract function execution errors (reverts)
  if (
    error instanceof ContractFunctionExecutionError ||
    error instanceof ContractFunctionRevertedError
  ) {
    const revertReason = extractRevertReason(error);
    return new SimulationFailedError({
      address: context.address,
      functionName: context.functionName,
      message: `Failed to simulate ${context.functionName} on ${context.address}${revertReason ? `: ${revertReason}` : ""}`,
      revertData: revertReason,
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
  context: { address: Address; functionName: string }
): ContractWriteError | InsufficientFundsError | UserRejectedError {
  // Check for user rejection first
  if (isUserRejection(error)) {
    return new UserRejectedError({
      message: error instanceof Error ? error.message : "User rejected the transaction",
    });
  }

  // Check for insufficient funds
  if (isInsufficientFunds(error)) {
    return new InsufficientFundsError({
      available: "0", // We don't have this info in the error
      message: error instanceof Error ? error.message : "Insufficient funds for transaction",
      required: "0", // We don't have this info in the error
    });
  }

  // Default: return generic contract write error
  return new ContractWriteError({
    address: context.address,
    cause: error,
    functionName: context.functionName,
    message: `Failed to write ${context.functionName} to ${context.address}`,
  });
}

/**
 * Classify gas estimation errors into specific error types
 */
export function classifyGasEstimationError(
  error: unknown,
  context: { address: Address; functionName: string }
): GasEstimationError | InsufficientFundsError | UserRejectedError {
  // Check for user rejection
  if (isUserRejection(error)) {
    return new UserRejectedError({
      message: error instanceof Error ? error.message : "User rejected the request",
    });
  }

  // Check for insufficient funds
  if (isInsufficientFunds(error)) {
    return new InsufficientFundsError({
      available: "0",
      message: error instanceof Error ? error.message : "Insufficient funds for gas estimation",
      required: "0",
    });
  }

  // Check for viem's EstimateGasExecutionError
  if (error instanceof EstimateGasExecutionError) {
    const revertReason = extractRevertReason(error.cause);
    return new GasEstimationError({
      address: context.address,
      cause: error,
      functionName: context.functionName,
      message: `Failed to estimate gas for ${context.functionName} on ${context.address}${revertReason ? `: ${revertReason}` : ""}`,
    });
  }

  // Default: return generic gas estimation error
  return new GasEstimationError({
    address: context.address,
    cause: error,
    functionName: context.functionName,
    message: `Failed to estimate gas for ${context.functionName} on ${context.address}`,
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
): UserRejectedError | SignTransactionError;
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
  | SignTransactionError
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
      return new SignTransactionError({
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
