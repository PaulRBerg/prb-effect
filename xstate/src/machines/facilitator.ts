import { Effect } from "effect";
import { assign, fromPromise, setup } from "xstate";

/**
 * Eligibility status for facilitated resources
 */
type EligibilityStatus = "idle" | "true" | "false" | "expired";

/**
 * Result from checking eligibility
 */
type FacilitatedResult<TTransitive> = {
  status: EligibilityStatus;
  transitive: TTransitive | null;
};

/**
 * Machine context for facilitator workflow
 */
type FacilitatorMachineContext<TTransitive> = {
  /** Error message from failed operations */
  error: string | null;
  /** Eligibility status */
  status: EligibilityStatus;
  /** Transitive data cached between check and create phases */
  transitive: TTransitive | null;
};

/**
 * Events that can be sent to the facilitator machine
 */
type FacilitatorMachineEvents<TCheck, TCreate> =
  | {
      type: "CHECK";
      payload: TCheck & { soft?: boolean };
    }
  | {
      type: "CREATE";
      payload: TCreate;
    }
  | { type: "RESET" };

/**
 * Services configuration for facilitator machine
 */
type FacilitatorMachineServices<TCheck, TCreate, TTransitive> = {
  onCheck: (
    payload: TCheck & { soft?: boolean }
  ) => Effect.Effect<FacilitatedResult<TTransitive>, Error>;
  onCreate: (input: {
    create: TCreate;
    transitive: TTransitive | null;
  }) => Effect.Effect<void, Error>;
};

/**
 * Configuration for creating a facilitator machine
 */
type FacilitatorMachineConfig<TCheck, TCreate, TTransitive> = {
  id: string;
  services: FacilitatorMachineServices<TCheck, TCreate, TTransitive>;
};

/**
 * Creates a check-then-create workflow state machine
 *
 * Flow:
 * 1. idle -> checking (on CHECK event) - checks eligibility/preconditions
 * 2. checking -> checked - eligibility confirmed, transitive data cached
 * 3. checked -> creating (on CREATE event) - creates the resource
 * 4. creating -> created - resource created successfully
 * 5. Any error state -> failed - operation failed (can retry)
 *
 * Key features:
 * - Checks can self-transition to handle dependency updates
 * - Transitive data flows from check to create phase
 * - EligibilityStatus tracks: idle, true, false, expired
 * - Terminal states can transition back to idle or retry operations
 *
 * @example
 * ```ts
 * const machine = createFacilitatorMachine({
 *   id: "claim-airdrop",
 *   services: {
 *     onCheck: (payload) =>
 *       Effect.succeed({ status: "true", transitive: { proof: "0x..." } }),
 *     onCreate: ({ create, transitive }) => Effect.succeed(undefined),
 *   },
 * });
 * ```
 */
function createFacilitatorMachine<TCheck, TCreate, TTransitive>({
  id,
  services,
}: FacilitatorMachineConfig<TCheck, TCreate, TTransitive>) {
  return setup({
    actions: {
      doCache: assign({
        error: () => null,
        status: ({ event }) => {
          if ("output" in event) {
            const result = event.output as FacilitatedResult<TTransitive>;
            return result.status;
          }
          return "idle" as const;
        },
        transitive: ({ event }) => {
          if ("output" in event) {
            const result = event.output as FacilitatedResult<TTransitive>;
            return result.transitive;
          }
          return null;
        },
      }),
      doClean: assign({
        error: () => null,
        status: () => "idle" as const,
        transitive: () => null,
      }),
      doError: assign({
        error: ({ event }) => {
          if ("error" in event && event.error instanceof Error) {
            return event.error.message;
          }
          return "An unknown error occurred";
        },
      }),
    },
    actors: {
      doCheck: fromPromise(async ({ input }: { input: TCheck & { soft?: boolean } }) =>
        Effect.runPromise(services.onCheck(input))
      ),
      doCreate: fromPromise(
        async ({ input }: { input: { create: TCreate; transitive: TTransitive | null } }) =>
          Effect.runPromise(services.onCreate(input))
      ),
    },
    types: {
      context: {} as FacilitatorMachineContext<TTransitive>,
      events: {} as FacilitatorMachineEvents<TCheck, TCreate>,
    },
  }).createMachine({
    context: {
      error: null,
      status: "idle",
      transitive: null,
    },
    id: `facilitator-${id}`,
    initial: "idle",
    states: {
      checked: {
        on: {
          CHECK: {
            target: "checking",
          },
          CREATE: {
            target: "creating",
          },
          RESET: {
            target: "idle",
          },
        },
      },
      checking: {
        entry: "doClean",
        // @ts-expect-error - xState v5 type inference limitation with generic functions
        invoke: {
          id: "check",
          input: ({ event }) => {
            if (event.type === "CHECK") {
              return event.payload;
            }
            throw new Error("Invalid event type for check");
          },
          onDone: {
            actions: "doCache",
            target: "checked",
          },
          onError: {
            actions: "doError",
            target: "failed",
          },
          src: "doCheck",
        },
        on: {
          CHECK: {
            target: "checking",
          },
          RESET: {
            target: "idle",
          },
        },
      },
      created: {
        on: {
          RESET: {
            target: "idle",
          },
        },
      },
      creating: {
        invoke: {
          id: "create",
          input: ({ event, context }) => {
            if (event.type === "CREATE") {
              return {
                create: event.payload,
                transitive: context.transitive,
              };
            }
            throw new Error("Invalid event type for create");
          },
          onDone: {
            target: "created",
          },
          onError: {
            actions: "doError",
            target: "failed",
          },
          src: "doCreate",
        },
        on: {
          RESET: {
            target: "idle",
          },
        },
      },
      failed: {
        on: {
          CHECK: {
            target: "checking",
          },
          CREATE: {
            target: "creating",
          },
          RESET: {
            target: "idle",
          },
        },
      },
      idle: {
        entry: "doClean",
        on: {
          CHECK: {
            target: "checking",
          },
        },
      },
    },
  });
}

export { createFacilitatorMachine };
export type {
  EligibilityStatus,
  FacilitatedResult,
  FacilitatorMachineConfig,
  FacilitatorMachineContext,
  FacilitatorMachineEvents,
  FacilitatorMachineServices,
};
