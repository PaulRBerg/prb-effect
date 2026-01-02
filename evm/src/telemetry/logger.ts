import { Effect } from "effect";

/**
 * Log levels for different operations
 */
export const logContractRead = (params: {
  address: string;
  functionName: string;
  chainId: number;
}) => Effect.logDebug("Contract read", params);

export const logContractWrite = (params: {
  address: string;
  functionName: string;
  chainId: number;
  hash?: string;
}) => Effect.logInfo("Contract write", params);

export const logTxLifecycle = (params: { hash: string; status: string; confirmations?: number }) =>
  Effect.logDebug("Transaction lifecycle", params);

export const logEventReceived = (params: {
  eventName: string;
  address: string;
  blockNumber: bigint;
}) => Effect.logDebug("Event received", params);

export const logError = (params: { operation: string; error: unknown }) =>
  Effect.logError("Operation failed", params);
