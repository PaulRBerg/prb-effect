import {
  ClientNotFoundError,
  TransportError,
  WalletNotConnectedError,
  WrongNetworkError,
} from "./client.js";
import {
  ContractReadError,
  ContractWriteError,
  GasEstimationError,
  SimulationFailedError,
} from "./contract.js";
import { EventDecodeError } from "./event.js";
import {
  InsufficientFundsError,
  ReceiptTimeoutError,
  ResourceExhaustionError,
  TransactionSubmissionError,
  TxFailedError,
  TxReplacedError,
  UserRejectedError,
} from "./tx.js";

export type UserFacingTxErrorCategory =
  | "cancelled"
  | "connect-wallet"
  | "insufficient-funds"
  | "network"
  | "retryable"
  | "switch-network"
  | "tx-failed"
  | "unknown";

export type UserFacingTxError = {
  readonly category: UserFacingTxErrorCategory;
  readonly message: string;
  readonly retryable: boolean;
  readonly raw: unknown;
};

type TaggedErrorShape = {
  readonly _tag?: unknown;
  readonly message?: unknown;
};

const GAS_ALLOWANCE_EXCEEDED_PATTERN = /gas required exceeds allowance/i;
const MISSING_OR_INVALID_PARAMETERS_PATTERN = /missing or invalid parameters/i;
const INSUFFICIENT_FUNDS_PATTERNS: RegExp[] = [
  /insufficient funds/i,
  /insufficient balance/i,
  /total cost \(gas \* gas fee \+ value\).*exceeds the balance/i,
];

function getMessage(error: unknown): string | undefined {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const message = (error as TaggedErrorShape).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pushCandidate(candidates: string[], value: unknown): void {
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  if (trimmed.length > 0) {
    candidates.push(trimmed);
  }
}

function getMessageCandidates(error: unknown): string[] {
  const candidates: string[] = [];
  const queue: unknown[] = [error];
  const visited = new WeakSet<object>();

  while (queue.length > 0) {
    const value = queue.shift();

    if (Array.isArray(value)) {
      for (const item of value) {
        queue.push(item);
      }
      continue;
    }

    pushCandidate(candidates, value);

    if (!isRecord(value) || visited.has(value)) {
      continue;
    }

    visited.add(value);

    pushCandidate(candidates, value.message);
    pushCandidate(candidates, value.shortMessage);
    pushCandidate(candidates, value.reason);
    pushCandidate(candidates, value.details);
    pushCandidate(candidates, value.revertReason);

    if ("cause" in value) {
      queue.push(value.cause);
    }

    if (Array.isArray(value.metaMessages)) {
      for (const message of value.metaMessages) {
        queue.push(message);
      }
    }
  }

  return Array.from(new Set(candidates));
}

function matchesAnyPattern(candidates: string[], patterns: RegExp[]): boolean {
  return candidates.some((candidate) => patterns.some((pattern) => pattern.test(candidate)));
}

function isRpcInsufficientFundsShape(candidates: string[]): boolean {
  return (
    matchesAnyPattern(candidates, [GAS_ALLOWANCE_EXCEEDED_PATTERN]) &&
    matchesAnyPattern(candidates, [MISSING_OR_INVALID_PARAMETERS_PATTERN])
  );
}

function isInferredInsufficientFundsError(error: unknown): boolean {
  const candidates = getMessageCandidates(error);
  return (
    matchesAnyPattern(candidates, INSUFFICIENT_FUNDS_PATTERNS) ||
    isRpcInsufficientFundsShape(candidates)
  );
}

function toFallbackMessage(error: unknown): string {
  return getMessage(error) ?? "Transaction failed due to an unknown error";
}

/**
 * Normalize known transaction errors into stable, user-facing categories/messages.
 *
 * Unknown values are preserved in `raw` for telemetry/debugging.
 */
export function toUserFacingTxError(error: unknown): UserFacingTxError {
  if (error instanceof UserRejectedError) {
    return {
      category: "cancelled",
      message: error.message || "Transaction was rejected",
      raw: error,
      retryable: false,
    };
  }

  if (error instanceof WalletNotConnectedError) {
    return {
      category: "connect-wallet",
      message: error.message || "Connect your wallet to continue",
      raw: error,
      retryable: false,
    };
  }

  if (error instanceof WrongNetworkError) {
    return {
      category: "switch-network",
      message: error.message || "Switch to the required network and try again",
      raw: error,
      retryable: false,
    };
  }

  if (error instanceof InsufficientFundsError) {
    return {
      category: "insufficient-funds",
      message: error.message || "Insufficient funds to submit this transaction",
      raw: error,
      retryable: false,
    };
  }

  if (error instanceof TransactionSubmissionError) {
    return {
      category: "retryable",
      message: error.message,
      raw: error,
      retryable: true,
    };
  }

  if (isInferredInsufficientFundsError(error)) {
    return {
      category: "insufficient-funds",
      message: "Insufficient funds to cover gas for this transaction",
      raw: error,
      retryable: false,
    };
  }

  if (
    error instanceof ClientNotFoundError ||
    error instanceof TransportError ||
    error instanceof ReceiptTimeoutError
  ) {
    return {
      category: "network",
      message: error.message || "Network error while processing the transaction",
      raw: error,
      retryable: true,
    };
  }

  if (error instanceof ResourceExhaustionError) {
    return {
      category: "retryable",
      message: error.message || "Device resources were exhausted while processing the transaction",
      raw: error,
      retryable: true,
    };
  }

  if (
    error instanceof TxFailedError ||
    error instanceof TxReplacedError ||
    error instanceof ContractReadError ||
    error instanceof ContractWriteError ||
    error instanceof GasEstimationError ||
    error instanceof SimulationFailedError ||
    error instanceof EventDecodeError
  ) {
    return {
      category: "tx-failed",
      message: error.message || "Transaction execution failed",
      raw: error,
      retryable: false,
    };
  }

  return {
    category: "unknown",
    message: toFallbackMessage(error),
    raw: error,
    retryable: false,
  };
}
