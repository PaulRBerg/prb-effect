import { Effect } from "effect";

/**
 * Log helpers for Solana operations.
 */

export const logRpcCall = (params: { method: string; cluster: string; params?: unknown }) =>
  Effect.logDebug("RPC call", params);

export const logTransactionSent = (params: { signature: string; cluster: string }) =>
  Effect.logInfo("Transaction sent", params);

export const logTransactionConfirmed = (params: {
  signature: string;
  slot: bigint;
  confirmations?: number;
}) => Effect.logDebug("Transaction confirmed", params);

export const logAccountChange = (params: { address: string; lamports: bigint; slot: bigint }) =>
  Effect.logDebug("Account change", params);

export const logEventReceived = (params: { programId: string; signature: string; slot: bigint }) =>
  Effect.logDebug("Event received", params);

export const logError = (params: { operation: string; error: unknown }) =>
  Effect.logError("Operation failed", params);
