/**
 * Hook for managing xState facilitator machines.
 *
 * Provides a React-friendly interface to xState facilitator state machines.
 * Handles eligibility checking, creation workflows, and transitive state management.
 */
"use client";

import { useActor } from "@xstate/react";
import type { AnyActorLogic, InspectionEvent, Observer } from "xstate";
import type { EligibilityStatus, FacilitatorMachineContext } from "#src/machines/index.js";

// =============================================================================
// Types
// =============================================================================

type FacilitatorMachineSnapshot<TTransitive> = {
  value: string;
  context: FacilitatorMachineContext<TTransitive>;
};

type UseFacilitatorWorkflowReturn<TCheck, TCreate, TTransitive> = {
  /** Current state value */
  state: string;

  /** Full machine context */
  context: FacilitatorMachineContext<TTransitive>;

  /** Error message if operation failed */
  error: string | null;

  /** Eligibility status */
  eligibility: EligibilityStatus;

  /** Transitive data from eligibility check */
  transitive: TTransitive | null;

  /** Convenient status flags */
  status: {
    isIdle: boolean;
    isChecking: boolean;
    isChecked: boolean;
    isCreating: boolean;
    isCreated: boolean;
    isFailed: boolean;
    isEligible: boolean;
    isNotEligible: boolean;
    isExpired: boolean;
    isLoading: boolean;
  };

  /** Trigger eligibility check */
  check: (payload: TCheck & { soft?: boolean }) => void;

  /** Trigger creation workflow */
  create: (payload: TCreate) => void;

  /** Reset to initial state */
  reset: () => void;

  /** Raw send function for custom events */
  send: (event: unknown) => void;

  /** Raw snapshot for advanced use cases */
  snapshot: FacilitatorMachineSnapshot<TTransitive>;
};

type UseFacilitatorWorkflowOptions = {
  /** Inspector function for xState Studio visualization */
  inspect?: Observer<InspectionEvent> | ((event: InspectionEvent) => void);
};

// =============================================================================
// Hook
// =============================================================================

/**
 * Manage xState facilitator machines for eligibility and creation workflows.
 */
export function useFacilitatorWorkflow<TCheck = unknown, TCreate = unknown, TTransitive = unknown>(
  machine: AnyActorLogic,
  options?: UseFacilitatorWorkflowOptions
): UseFacilitatorWorkflowReturn<TCheck, TCreate, TTransitive> {
  const [snapshot, send] = useActor(machine, { inspect: options?.inspect });

  const check = (payload: TCheck & { soft?: boolean }) => send({ payload, type: "CHECK" });

  const create = (payload: TCreate) => send({ payload, type: "CREATE" });

  const reset = () => send({ type: "RESET" });

  const typedSnapshot = snapshot as FacilitatorMachineSnapshot<TTransitive>;
  const eligibility = typedSnapshot.context.status;

  const status = {
    isChecked: typedSnapshot.value === "checked",
    isChecking: typedSnapshot.value === "checking",
    isCreated: typedSnapshot.value === "created",
    isCreating: typedSnapshot.value === "creating",
    isEligible: eligibility === "true",
    isExpired: eligibility === "expired",
    isFailed: typedSnapshot.value === "failed",
    isIdle: typedSnapshot.value === "idle",
    isLoading: ["checking", "creating"].includes(typedSnapshot.value),
    isNotEligible: eligibility === "false",
  };

  return {
    check,
    context: typedSnapshot.context,
    create,
    eligibility,
    error: typedSnapshot.context.error,
    reset,
    send,
    snapshot: typedSnapshot,
    state: typedSnapshot.value,
    status,
    transitive: typedSnapshot.context.transitive,
  };
}
