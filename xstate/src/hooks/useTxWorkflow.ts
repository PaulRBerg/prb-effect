/**
 * Hook for managing xState transaction machines.
 *
 * Provides a React-friendly interface to xState transaction state machines.
 * Handles gas estimation, simulation, signing, and transaction confirmation.
 *
 * @example
 * ```typescript
 * function SendTransaction() {
 *   const { status, submit, reset, errorMessage, hash, gasLimit } = useTxWorkflow<
 *     TransferPayload,
 *     PreprocessedData,
 *     SignatureResult,
 *     TransactionReceipt
 *   >(transferMachine);
 *
 *   if (status.isSuccess) {
 *     return <div>Transaction confirmed: {hash}</div>;
 *   }
 *
 *   if (status.isGasLimitOverflow) {
 *     return <div>Gas limit too high for this chain</div>;
 *   }
 *
 *   return (
 *     <form onSubmit={(e) => {
 *       e.preventDefault();
 *       submit(formData);
 *     }}>
 *       {status.isLoading && <Spinner />}
 *       {errorMessage && <ErrorMessage>{errorMessage}</ErrorMessage>}
 *       <button type="submit" disabled={status.isLoading}>
 *         Send Transaction
 *       </button>
 *     </form>
 *   );
 * }
 * ```
 */
"use client";

import { useActor } from "@xstate/react";
import type { AnyActorLogic, InspectionEvent, Observer } from "xstate";
import type { TxError } from "#src/errors/index.js";
import type { GasLimitOverflow, TxMachineContext, TxMachineEvents } from "#src/machines/index.js";

// =============================================================================
// Types
// =============================================================================

type TxMachineSnapshot<TPayload, TPreprocess, TSignResult, TResult> = {
  value: string;
  context: TxMachineContext<TPayload, TPreprocess, TSignResult, TResult>;
};

type UseTxWorkflowReturn<TPayload, TPreprocess, TSignResult, TResult> = {
  /** Current state value */
  state: string;

  /** Full machine context */
  context: TxMachineContext<TPayload, TPreprocess, TSignResult, TResult>;

  /** Raw snapshot for advanced use cases */
  snapshot: TxMachineSnapshot<TPayload, TPreprocess, TSignResult, TResult>;

  /** Raw send function for custom events */
  send: (event: TxMachineEvents<TPayload>) => void;

  /** Structured error data if operation failed */
  error: TxError | null;

  /** Convenience error message for UI rendering */
  errorMessage: string | null;

  /** Estimated gas limit */
  gasLimit: bigint | undefined;

  /** Gas limit overflow information */
  gasLimitOverflow: GasLimitOverflow | null;

  /** Transaction hash */
  hash: string | null;

  /** Preprocessed data from validation step */
  preprocess: TPreprocess | null;

  /** Result from signing step */
  signResult: TSignResult | null;

  /** Final result from transaction confirmation */
  result: TResult | null;

  /** Convenient status flags */
  status: {
    isIdle: boolean;
    isValidating: boolean;
    isCheckingGas: boolean;
    isSimulating: boolean;
    isSigning: boolean;
    isPending: boolean;
    isSuccess: boolean;
    isFailure: boolean;
    isGasLimitOverflow: boolean;
    isLoading: boolean;
  };

  /** Submit transaction payload */
  submit: (payload: TPayload) => void;

  /** Reset to initial state */
  reset: () => void;
};

type UseTxWorkflowOptions = {
  /** Inspector function for xState Studio visualization */
  inspect?: Observer<InspectionEvent> | ((event: InspectionEvent) => void);
};

// =============================================================================
// Hook
// =============================================================================

/**
 * Manage xState transaction machines with gas estimation and signing.
 *
 * This hook wraps an xState transaction machine to provide a React-friendly API.
 * It handles the typical transaction workflow: validate → check gas → simulate → sign → pending → success/failure.
 *
 * Features:
 * - Automatic state management via xState
 * - Gas estimation with overflow detection
 * - Transaction simulation
 * - Signing and confirmation tracking
 * - Error handling and recovery
 * - Full TypeScript type safety
 *
 * @param machine - xState transaction machine instance
 * @param options - Optional configuration including inspector
 * @returns Transaction state and control functions
 */
export function useTxWorkflow<
  TPayload = unknown,
  TPreprocess = unknown,
  TSignResult = unknown,
  TResult = unknown,
>(
  machine: AnyActorLogic,
  options?: UseTxWorkflowOptions
): UseTxWorkflowReturn<TPayload, TPreprocess, TSignResult, TResult> {
  const [snapshot, send] = useActor(machine, { inspect: options?.inspect });

  const submit = (payload: TPayload) =>
    send({ payload, type: "SUBMIT" } as TxMachineEvents<TPayload>);

  const reset = () => send({ type: "RESET" } as TxMachineEvents<TPayload>);

  const typedSnapshot = snapshot as TxMachineSnapshot<TPayload, TPreprocess, TSignResult, TResult>;
  const state = typedSnapshot.value;
  const context = typedSnapshot.context;

  const status = {
    isCheckingGas: snapshot.matches("gasCheck"),
    isFailure: state === "failure",
    isGasLimitOverflow: state === "gasLimitOverflow",
    isIdle: snapshot.matches("initial"),
    isLoading: ["validate", "gasCheck", "simulate", "signing", "pending"].some((value) =>
      snapshot.matches(value)
    ),
    isPending: state === "pending",
    isSigning: state === "signing",
    isSimulating: snapshot.matches("simulate"),
    isSuccess: state === "success",
    isValidating: snapshot.matches("validate"),
  };

  return {
    context,
    error: context.error,
    errorMessage: context.errorMessage,
    gasLimit: context.gasLimit,
    gasLimitOverflow: context.gasLimitOverflow,
    hash: context.hash,
    preprocess: context.preprocess,
    reset,
    result: context.result,
    send: send as (event: TxMachineEvents<TPayload>) => void,
    signResult: context.signResult,
    snapshot: typedSnapshot,
    state,
    status,
    submit,
  };
}
