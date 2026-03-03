import { Effect } from "effect";
import { assign, fromPromise, setup } from "xstate";

/**
 * Machine context for form workflow
 */
type FormMachineContext<TPayload, TResult, TPreprocess> = {
  /** Error message from failed operations */
  error: string | null;
  /** The form payload to be processed */
  payload: TPayload | null;
  /** Preprocessed data from validation */
  preprocess: TPreprocess | null;
  /** Result from successful processing */
  result: TResult | null;
};

/**
 * Events that can be sent to the form machine
 */
type FormMachineEvents<TCheck, TPayload> =
  | { type: "SAVE"; payload: TPayload }
  | { type: "CHECK"; payload: TCheck }
  | { type: "RESET" };

/**
 * Services configuration for form machine.
 *
 * All service functions receive plain values and return Effects with no requirements.
 * If your service needs dependencies (like ContractWriterService), provide them
 * before passing to the machine:
 *
 * @example
 * ```ts
 * // Wrap service with its layer before passing to machine
 * const wrappedProcess = (input) =>
 *   Effect.provide(processLockupCreate(input), ContractWriterLive);
 * ```
 */
type FormMachineServices<TCheck, TPayload, TResult, TPreprocess> = {
  onCheck: (payload: TCheck) => Effect.Effect<void, Error>;
  onValidate: (payload: TPayload) => Effect.Effect<TPreprocess, Error>;
  onProcess: (input: {
    payload: TPayload;
    preprocess: TPreprocess;
  }) => Effect.Effect<TResult, Error>;
};

/**
 * Configuration for creating a form machine
 */
type FormMachineConfig<TCheck, TPayload, TResult, TPreprocess> = {
  id: string;
  services: FormMachineServices<TCheck, TPayload, TResult, TPreprocess>;
  /**
   * Optional predicate to detect user rejection errors.
   * When provided, user rejections will reset to initial state instead of going to failure.
   * Useful for wallet interactions where users can cancel.
   */
  isUserRejectedError?: (error: unknown) => boolean;
};

/**
 * Creates a generic form workflow state machine
 *
 * Flow:
 * 1. initial -> check (on CHECK event) - validates dependencies/preconditions
 * 2. initial -> validate (on SAVE event) - validates payload
 * 3. validate -> process - executes main operation
 * 4. process -> success - operation completed
 * 5. process -> failure - operation failed (can retry via SAVE)
 *
 * Key features:
 * - Check state supports self-transitions to handle dependency updates
 * - Validation preprocesses data before processing
 * - Terminal states (success/failure) can transition back to validate or initial
 *
 * @example
 * ```ts
 * const machine = createFormMachine({
 *   id: "create-stream",
 *   services: {
 *     onCheck: (payload) => Effect.succeed(undefined),
 *     onValidate: (payload) => Effect.succeed({ validated: true }),
 *     onProcess: ({ payload, preprocess }) => Effect.succeed(undefined),
 *   },
 * });
 * ```
 */
function createFormMachine<TCheck, TPayload, TResult, TPreprocess = undefined>({
  id,
  services,
  isUserRejectedError,
}: FormMachineConfig<TCheck, TPayload, TResult, TPreprocess>) {
  return setup({
    actions: {
      doCache: assign({
        payload: ({ context, event }) => {
          if (event.type === "SAVE") {
            return event.payload;
          }
          return context.payload;
        },
      }),
      doError: assign({
        error: ({ event }) => {
          if ("error" in event && event.error instanceof Error) {
            return event.error.message;
          }
          return "An unknown error occurred";
        },
      }),
      doPrepareSave: assign({
        error: () => null,
        preprocess: () => null,
        result: () => null,
      }),
      doPreprocess: assign({
        preprocess: ({ event }) => {
          if ("output" in event) {
            return event.output as TPreprocess;
          }
          return null;
        },
      }),
      doReset: assign({
        error: () => null,
        payload: () => null,
        preprocess: () => null,
        result: () => null,
      }),
      doResult: assign({
        error: () => null,
        result: ({ event }) => {
          if ("output" in event) {
            return event.output as TResult;
          }
          return null;
        },
      }),
    },
    actors: {
      doCheck: fromPromise(async ({ input }: { input: TCheck }) =>
        Effect.runPromise(services.onCheck(input))
      ),
      doProcess: fromPromise(
        async ({ input }: { input: { payload: TPayload; preprocess: TPreprocess } }) =>
          Effect.runPromise(services.onProcess(input))
      ),
      doValidate: fromPromise(async ({ input }: { input: TPayload }) =>
        Effect.runPromise(services.onValidate(input))
      ),
    },
    types: {
      context: {} as FormMachineContext<TPayload, TResult, TPreprocess>,
      events: {} as FormMachineEvents<TCheck, TPayload>,
    },
  }).createMachine({
    context: {
      error: null,
      payload: null,
      preprocess: null,
      result: null,
    },
    id: `formMachine-${id}`,
    initial: "initial",
    states: {
      check: {
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
            actions: "doReset",
            target: "initial",
          },
          onError: {
            actions: "doError",
            target: "initial",
          },
          src: "doCheck",
        },
        on: {
          CHECK: {
            actions: "doReset",
            target: "check",
          },
        },
      },
      failure: {
        on: {
          RESET: {
            actions: "doReset",
            target: "initial",
          },
          SAVE: {
            actions: "doPrepareSave",
            target: "validate",
          },
        },
      },
      initial: {
        on: {
          CHECK: {
            target: "check",
          },
          SAVE: {
            actions: "doPrepareSave",
            target: "validate",
          },
        },
      },
      process: {
        invoke: {
          id: "process",
          input: ({ context }) => {
            if (context.payload === null) {
              throw new Error("Missing payload for process");
            }
            if (context.preprocess === null) {
              throw new Error("Missing preprocess data for process");
            }
            return {
              payload: context.payload,
              preprocess: context.preprocess,
            };
          },
          onDone: {
            actions: "doResult",
            target: "success",
          },
          onError: isUserRejectedError
            ? [
                {
                  actions: "doReset",
                  guard: ({ event }) => isUserRejectedError(event.error),
                  target: "initial",
                },
                {
                  actions: "doError",
                  target: "failure",
                },
              ]
            : {
                actions: "doError",
                target: "failure",
              },
          src: "doProcess",
        },
      },
      success: {
        on: {
          RESET: {
            actions: "doReset",
            target: "initial",
          },
          SAVE: {
            actions: "doPrepareSave",
            target: "validate",
          },
        },
      },
      validate: {
        entry: "doCache",
        // @ts-expect-error - xState v5 type inference limitation with generic functions
        invoke: {
          id: "validate",
          input: ({ context }) => {
            if (context.payload === null) {
              throw new Error("Missing payload for validate");
            }
            return context.payload;
          },
          onDone: {
            actions: "doPreprocess",
            target: "process",
          },
          onError: {
            actions: "doError",
            target: "failure",
          },
          src: "doValidate",
        },
      },
    },
  });
}

export { createFormMachine };
export type { FormMachineConfig, FormMachineContext, FormMachineEvents, FormMachineServices };
