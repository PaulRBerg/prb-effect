import { Effect } from "effect";
import { assign, fromPromise, setup } from "xstate";
import type { TxError } from "#src/errors/index.js";
import { extractErrorData } from "#src/errors/index.js";

/**
 * Gas limit overflow information
 */
type GasLimitOverflow = {
  /** Block gas limit for the target chain */
  blockGasLimit: bigint;
  /** Effective limit after applying per-tx caps */
  effectiveLimit: bigint;
  /** Estimated gas required for the transaction */
  estimatedGas: bigint;
  /** Reason for overflow: exceeded block limit or per-tx cap */
  reason: "exceeded" | "tx-cap";
};

/**
 * Machine context for transaction workflow
 */
type TxMachineContext<TPayload, TPreprocess, TSignResult, TResult> = {
  /** Structured error data from failed operations */
  error: TxError | null;
  /** Convenience error message for UI rendering */
  errorMessage: string | null;
  /** Gas limit to use for the transaction */
  gasLimit: bigint | undefined;
  /** Gas limit overflow details when transaction exceeds limits */
  gasLimitOverflow: GasLimitOverflow | null;
  /** Transaction hash after signing */
  hash: string | null;
  /** The transaction payload */
  payload: TPayload | null;
  /** Preprocessed data from validation */
  preprocess: TPreprocess | null;
  /** Sign result (hash for EOA, Safe tx details for Safe) */
  signResult: TSignResult | null;
  /** Final transaction result after confirmation */
  result: TResult | null;
};

/**
 * Events that can be sent to the transaction machine
 */
type TxMachineEvents<TPayload> = { type: "SUBMIT"; payload: TPayload } | { type: "RESET" };

/**
 * Services configuration for transaction machine.
 *
 * All service functions receive plain values and return Effects with no requirements.
 * If your service needs dependencies, provide them before passing to the machine.
 */
type TxMachineServices<TPayload, TPreprocess, TSignResult, TResult> = {
  /** Validates the payload and returns preprocessed data */
  onValidate: (payload: TPayload) => Effect.Effect<TPreprocess, Error>;
  /** Gas check for EOA wallets - returns gas limit or overflow */
  onGasCheck?: (input: {
    payload: TPayload;
    preprocess: TPreprocess;
  }) => Effect.Effect<{ gasLimit: bigint } | { overflow: GasLimitOverflow }, Error>;
  /** Simulation for Safe wallets - may return overflow */
  onSimulate?: (input: {
    payload: TPayload;
    preprocess: TPreprocess;
  }) => Effect.Effect<undefined | { overflow: GasLimitOverflow }, Error>;
  /** Signs the transaction */
  onSign: (input: {
    payload: TPayload;
    preprocess: TPreprocess;
    gasLimit?: bigint;
  }) => Effect.Effect<TSignResult, Error>;
  /** Confirms the transaction and returns final result */
  onConfirm: (input: {
    payload: TPayload;
    signResult: TSignResult;
  }) => Effect.Effect<TResult, Error>;
};

/**
 * Configuration for creating a transaction machine
 */
type TxMachineConfig<TPayload, TPreprocess, TSignResult, TResult> = {
  /** Unique identifier for the machine */
  id: string;
  /** Service implementations */
  services: TxMachineServices<TPayload, TPreprocess, TSignResult, TResult>;
  /** Determines wallet type from payload for branching logic */
  getWalletType: (payload: TPayload) => "safe" | "eoa";
  /** Optional predicate to detect user rejection errors */
  isUserRejectedError?: (error: unknown) => boolean;
  /** Optional function to extract overflow info from errors */
  isGasLimitOverflowError?: (error: unknown) => GasLimitOverflow | undefined;
};

const UNKNOWN_TX_ERROR_MESSAGE = "An unknown error occurred";

function getTxErrorMessage(error: TxError): string {
  return typeof error === "string" ? error : error.message;
}

function normalizeTxError(error: unknown): {
  error: TxError;
  errorMessage: string;
} {
  const txError = extractErrorData(error, UNKNOWN_TX_ERROR_MESSAGE);

  return {
    error: txError,
    errorMessage: getTxErrorMessage(txError),
  };
}

/**
 * Creates a transaction workflow state machine with branching paths for Safe vs EOA wallets.
 *
 * Flow:
 * - EOA: initial → validate → gasCheck → signing → pending → success
 * - Safe: initial → validate → simulate → signing → pending → success
 * - Gas overflow: → gasLimitOverflow (terminal, requires RESET)
 *
 * Key features:
 * - Branching based on wallet type (Safe vs EOA)
 * - Gas limit checking with overflow detection
 * - Two-phase execution (sign → confirm)
 * - User rejection handling returns to initial state
 *
 * @example
 * ```ts
 * const machine = createTxMachine({
 *   id: "create-stream",
 *   services: {
 *     onValidate: (payload) => Effect.succeed({ validated: true }),
 *     onGasCheck: ({ payload, preprocess }) => Effect.succeed({ gasLimit: 100000n }),
 *     onSign: ({ payload, preprocess, gasLimit }) => Effect.succeed("0x..."),
 *     onConfirm: ({ payload, signResult }) => Effect.succeed({ txHash: "0x..." }),
 *   },
 *   getWalletType: (payload) => payload.isSafe ? "safe" : "eoa",
 * });
 * ```
 */
function createTxMachine<TPayload, TPreprocess, TSignResult, TResult>({
  id,
  services,
  getWalletType,
  isUserRejectedError,
  isGasLimitOverflowError,
}: TxMachineConfig<TPayload, TPreprocess, TSignResult, TResult>) {
  return setup({
    actions: {
      doCache: assign({
        error: ({ context, event }) => (event.type === "SUBMIT" ? null : context.error),
        errorMessage: ({ context, event }) =>
          event.type === "SUBMIT" ? null : context.errorMessage,
        gasLimit: ({ context, event }) => (event.type === "SUBMIT" ? undefined : context.gasLimit),
        gasLimitOverflow: ({ context, event }) =>
          event.type === "SUBMIT" ? null : context.gasLimitOverflow,
        hash: ({ context, event }) => (event.type === "SUBMIT" ? null : context.hash),
        payload: ({ context, event }) =>
          event.type === "SUBMIT" ? event.payload : context.payload,
        preprocess: ({ context, event }) => (event.type === "SUBMIT" ? null : context.preprocess),
        result: ({ context, event }) => (event.type === "SUBMIT" ? null : context.result),
        signResult: ({ context, event }) => (event.type === "SUBMIT" ? null : context.signResult),
      }),
      doError: assign(({ event }) => {
        return normalizeTxError("error" in event ? event.error : undefined);
      }),
      doGasLimit: assign({
        gasLimit: ({ event }) => {
          if ("output" in event && event.output && typeof event.output === "object") {
            const output = event.output as { gasLimit?: bigint };
            if ("gasLimit" in output) {
              return output.gasLimit;
            }
          }
          return undefined;
        },
      }),
      doGasLimitOverflow: assign({
        gasLimitOverflow: ({ event }) => {
          if ("output" in event && event.output && typeof event.output === "object") {
            const output = event.output as { overflow?: GasLimitOverflow };
            if ("overflow" in output && output.overflow) {
              return output.overflow;
            }
          }
          return null;
        },
      }),
      doGasLimitOverflowFromError: assign({
        gasLimitOverflow: ({ event }) => {
          if (isGasLimitOverflowError && "error" in event) {
            const overflow = isGasLimitOverflowError(event.error);
            if (overflow) {
              return overflow;
            }
          }
          return null;
        },
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
        errorMessage: () => null,
        gasLimit: () => undefined,
        gasLimitOverflow: () => null,
        hash: () => null,
        payload: () => null,
        preprocess: () => null,
        result: () => null,
        signResult: () => null,
      }),
      doResult: assign({
        hash: ({ context, event }) => {
          if ("output" in event && event.output && typeof event.output === "object") {
            const output = event.output as { hash?: unknown };
            if ("hash" in output && (typeof output.hash === "string" || output.hash === null)) {
              return output.hash;
            }
          }
          return context.hash;
        },
        result: ({ event }) => {
          if ("output" in event) {
            return event.output as TResult;
          }
          return null;
        },
      }),
      doSignResult: assign({
        hash: ({ event }) => {
          if ("output" in event && event.output && typeof event.output === "object") {
            const output = event.output as { hash?: string };
            if ("hash" in output && typeof output.hash === "string") {
              return output.hash;
            }
          }
          return null;
        },
        signResult: ({ event }) => {
          if ("output" in event) {
            return event.output as TSignResult;
          }
          return null;
        },
      }),
    },
    actors: {
      doConfirm: fromPromise(
        async ({ input }: { input: { payload: TPayload; signResult: TSignResult } }) =>
          Effect.runPromise(services.onConfirm(input))
      ),
      doGasCheck: fromPromise(
        async ({ input }: { input: { payload: TPayload; preprocess: TPreprocess } }) => {
          if (!services.onGasCheck) {
            return { gasLimit: undefined };
          }
          return await Effect.runPromise(services.onGasCheck(input));
        }
      ),
      doSign: fromPromise(
        async ({
          input,
        }: {
          input: { payload: TPayload; preprocess: TPreprocess; gasLimit?: bigint };
        }) => Effect.runPromise(services.onSign(input))
      ),
      doSimulate: fromPromise(
        async ({ input }: { input: { payload: TPayload; preprocess: TPreprocess } }) => {
          if (!services.onSimulate) {
            return undefined;
          }
          return await Effect.runPromise(services.onSimulate(input));
        }
      ),
      doValidate: fromPromise(async ({ input }: { input: TPayload }) =>
        Effect.runPromise(services.onValidate(input))
      ),
    },
    guards: {
      hasGasLimitOverflow: ({ event }) => {
        if ("output" in event && event.output && typeof event.output === "object") {
          const output = event.output as { overflow?: GasLimitOverflow };
          return "overflow" in output && output.overflow !== undefined;
        }
        return false;
      },
      isEoaWallet: ({ context }) => {
        if (!context.payload) {
          return false;
        }
        return getWalletType(context.payload) === "eoa";
      },
      isGasLimitOverflowError: ({ event }) => {
        if (isGasLimitOverflowError && "error" in event) {
          return isGasLimitOverflowError(event.error) !== undefined;
        }
        return false;
      },
      isSafeWallet: ({ context }) => {
        if (!context.payload) {
          return false;
        }
        return getWalletType(context.payload) === "safe";
      },
      isUserRejectedError: ({ event }) => {
        if (isUserRejectedError && "error" in event) {
          return isUserRejectedError(event.error);
        }
        return false;
      },
    },
    types: {
      context: {} as TxMachineContext<TPayload, TPreprocess, TSignResult, TResult>,
      events: {} as TxMachineEvents<TPayload>,
    },
  }).createMachine({
    context: {
      error: null,
      errorMessage: null,
      gasLimit: undefined,
      gasLimitOverflow: null,
      hash: null,
      payload: null,
      preprocess: null,
      result: null,
      signResult: null,
    },
    id: `txMachine-${id}`,
    initial: "initial",
    states: {
      failure: {
        on: {
          RESET: {
            actions: "doReset",
            target: "initial",
          },
          SUBMIT: {
            target: "validate",
          },
        },
      },
      gasCheck: {
        invoke: {
          id: "gasCheck",
          input: ({ context }) => {
            if (context.payload === null) {
              throw new Error("Missing payload for gas check");
            }
            if (context.preprocess === null) {
              throw new Error("Missing preprocess data for gas check");
            }
            return {
              payload: context.payload,
              preprocess: context.preprocess,
            };
          },
          onDone: [
            {
              actions: "doGasLimitOverflow",
              guard: "hasGasLimitOverflow",
              target: "gasLimitOverflow",
            },
            {
              actions: "doGasLimit",
              target: "signing",
            },
          ],
          onError: isGasLimitOverflowError
            ? [
                {
                  actions: "doGasLimitOverflowFromError",
                  guard: "isGasLimitOverflowError",
                  target: "gasLimitOverflow",
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
          src: "doGasCheck",
        },
      },
      gasLimitOverflow: {
        on: {
          RESET: {
            actions: "doReset",
            target: "initial",
          },
        },
      },
      initial: {
        on: {
          SUBMIT: {
            target: "validate",
          },
        },
      },
      pending: {
        invoke: {
          id: "confirm",
          input: ({ context }) => {
            if (context.payload === null) {
              throw new Error("Missing payload for confirmation");
            }
            if (context.signResult === null) {
              throw new Error("Missing sign result for confirmation");
            }
            return {
              payload: context.payload,
              signResult: context.signResult,
            };
          },
          onDone: {
            actions: "doResult",
            target: "success",
          },
          onError: {
            actions: "doError",
            target: "failure",
          },
          src: "doConfirm",
        },
      },
      signing: {
        invoke: {
          id: "sign",
          input: ({ context }) => {
            if (context.payload === null) {
              throw new Error("Missing payload for signing");
            }
            if (context.preprocess === null) {
              throw new Error("Missing preprocess data for signing");
            }
            return {
              gasLimit: context.gasLimit,
              payload: context.payload,
              preprocess: context.preprocess,
            };
          },
          onDone: {
            actions: "doSignResult",
            target: "pending",
          },
          onError: isUserRejectedError
            ? [
                {
                  actions: "doReset",
                  guard: "isUserRejectedError",
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
          src: "doSign",
        },
      },
      simulate: {
        invoke: {
          id: "simulate",
          input: ({ context }) => {
            if (context.payload === null) {
              throw new Error("Missing payload for simulation");
            }
            if (context.preprocess === null) {
              throw new Error("Missing preprocess data for simulation");
            }
            return {
              payload: context.payload,
              preprocess: context.preprocess,
            };
          },
          onDone: [
            {
              actions: "doGasLimitOverflow",
              guard: "hasGasLimitOverflow",
              target: "gasLimitOverflow",
            },
            {
              target: "signing",
            },
          ],
          onError: isGasLimitOverflowError
            ? [
                {
                  actions: "doGasLimitOverflowFromError",
                  guard: "isGasLimitOverflowError",
                  target: "gasLimitOverflow",
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
          src: "doSimulate",
        },
      },
      success: {
        on: {
          RESET: {
            actions: "doReset",
            target: "initial",
          },
          SUBMIT: {
            target: "validate",
          },
        },
      },
      validate: {
        entry: "doCache",
        // @ts-expect-error - xState v5 type inference limitation with generic functions
        invoke: {
          id: "validate",
          input: ({ event }) => {
            if (event.type !== "SUBMIT") {
              throw new Error("Invalid event type for validation");
            }
            return event.payload;
          },
          onDone: [
            {
              actions: "doPreprocess",
              guard: "isSafeWallet",
              target: "simulate",
            },
            {
              actions: "doPreprocess",
              guard: "isEoaWallet",
              target: "gasCheck",
            },
            {
              actions: "doPreprocess",
              target: "gasCheck",
            },
          ],
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

export { createTxMachine };
export type {
  GasLimitOverflow,
  TxMachineConfig,
  TxMachineContext,
  TxMachineEvents,
  TxMachineServices,
};
