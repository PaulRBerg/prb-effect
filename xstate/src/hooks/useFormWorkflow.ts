/**
 * Hook for managing xState form machines.
 *
 * Provides a React-friendly interface to xState form state machines.
 * Handles form validation, preprocessing, submission, and error handling.
 *
 * @example
 * ```typescript
 * function CreateStreamForm() {
 *   const { status, check, save, reset, error, preprocess } = useFormWorkflow<
 *     CheckPayload,
 *     SavePayload,
 *     Result,
 *     PreprocessedData
 *   >(createStreamMachine);
 *
 *   if (status.isSuccess) {
 *     return <div>Stream created successfully!</div>;
 *   }
 *
 *   return (
 *     <form onSubmit={(e) => {
 *       e.preventDefault();
 *       save(formData);
 *     }}>
 *       {status.isLoading && <Spinner />}
 *       {error && <ErrorMessage>{error}</ErrorMessage>}
 *       <button type="submit" disabled={status.isLoading}>
 *         Create Stream
 *       </button>
 *     </form>
 *   );
 * }
 * ```
 */
"use client";

import { useActor } from "@xstate/react";
import type { AnyActorLogic, InspectionEvent, Observer } from "xstate";
import type { FormMachineContext } from "#src/machines/index.js";

// =============================================================================
// Types
// =============================================================================

type FormMachineSnapshot<TPayload, TResult, TPreprocess> = {
  value: string;
  context: FormMachineContext<TPayload, TResult, TPreprocess>;
};

type UseFormWorkflowReturn<TCheck, TPayload, TResult, TPreprocess> = {
  /** Current state value */
  state: string;

  /** Full machine context */
  context: FormMachineContext<TPayload, TResult, TPreprocess>;

  /** Error message if operation failed */
  error: string | null;

  /** Preprocessed data from validation step */
  preprocess: TPreprocess;

  /** Result from successful processing step */
  result: TResult | null;

  /** Convenient status flags */
  status: {
    isIdle: boolean;
    isChecking: boolean;
    isValidating: boolean;
    isProcessing: boolean;
    isSuccess: boolean;
    isFailure: boolean;
    isLoading: boolean;
  };

  /** Trigger validation check */
  check: (payload: TCheck) => void;

  /** Submit form data */
  save: (payload: TPayload) => void;

  /** Reset to initial state */
  reset: () => void;

  /** Raw send function for custom events */
  send: (event: unknown) => void;

  /** Raw snapshot for advanced use cases */
  snapshot: FormMachineSnapshot<TPayload, TResult, TPreprocess>;
};

type UseFormWorkflowOptions = {
  /** Inspector function for xState Studio visualization */
  inspect?: Observer<InspectionEvent> | ((event: InspectionEvent) => void);
};

// =============================================================================
// Hook
// =============================================================================

/**
 * Manage xState form machines with validation and preprocessing.
 *
 * This hook wraps an xState form machine to provide a React-friendly API.
 * It handles the typical form workflow: check → validate → process → success/failure.
 *
 * Features:
 * - Automatic state management via xState
 * - Validation with preprocessing
 * - Error handling and recovery
 * - Full TypeScript type safety
 *
 * @param machine - xState form machine instance
 * @param options - Optional configuration including inspector
 * @returns Form state and control functions
 */
export function useFormWorkflow<
  TCheck = unknown,
  TPayload = unknown,
  TResult = unknown,
  TPreprocess = unknown,
>(
  machine: AnyActorLogic,
  options?: UseFormWorkflowOptions
): UseFormWorkflowReturn<TCheck, TPayload, TResult, TPreprocess> {
  const [snapshot, send] = useActor(machine, { inspect: options?.inspect });

  const check = (payload: TCheck) => send({ payload, type: "CHECK" });

  const save = (payload: TPayload) => send({ payload, type: "SAVE" });

  const reset = () => send({ type: "RESET" });

  const typedSnapshot = snapshot as FormMachineSnapshot<TPayload, TResult, TPreprocess>;

  const status = {
    isChecking: typedSnapshot.value === "check",
    isFailure: typedSnapshot.value === "failure",
    isIdle: typedSnapshot.value === "initial",
    isLoading: ["check", "validate", "process"].includes(typedSnapshot.value),
    isProcessing: typedSnapshot.value === "process",
    isSuccess: typedSnapshot.value === "success",
    isValidating: typedSnapshot.value === "validate",
  };

  return {
    check,
    context: typedSnapshot.context,
    error: typedSnapshot.context.error,
    preprocess: typedSnapshot.context.preprocess,
    reset,
    result: typedSnapshot.context.result,
    save,
    send,
    snapshot: typedSnapshot,
    state: typedSnapshot.value,
    status,
  };
}
