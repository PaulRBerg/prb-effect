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
  TxFailedError,
  TxReplacedError,
  UserRejectedError,
} from "./transaction.js";

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
