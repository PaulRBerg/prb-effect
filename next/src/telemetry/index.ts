import "server-only";

import { Effect, Layer } from "effect";
import * as Context from "effect/Context";

/**
 * @category models
 */
export type TelemetryAdapter = {
  readonly captureException: (error: Error) => void;
  readonly captureMessage: (message: string, level?: string) => void;
  readonly setContext?: (name: string, context: Record<string, unknown>) => void;
  readonly withScope?: <A>(fn: (scope: unknown) => A) => A;
};

/**
 * @category models
 */
export type Telemetry = {
  readonly captureException: (
    error: unknown,
    context?: Record<string, unknown>
  ) => Effect.Effect<void, never, never>;
  readonly captureMessage: (message: string, level?: string) => Effect.Effect<void, never, never>;
  readonly withScope: <A>(fn: (scope: unknown) => A) => Effect.Effect<A, never, never>;
};

/**
 * @category tags
 */
export class TelemetryService extends Context.Tag("effect-next/Telemetry")<
  TelemetryService,
  Telemetry
>() {}

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" ? error : String(error));
};

/**
 * Creates a telemetry service from a user-supplied adapter.
 *
 * @category utils
 */
export const makeTelemetryService = (adapter: TelemetryAdapter): Telemetry => ({
  captureException: Effect.fn("captureException")(function* (
    error: unknown,
    context?: Record<string, unknown>
  ) {
    yield* Effect.sync(() => {
      if (adapter.withScope) {
        adapter.withScope(() => {
          if (context && adapter.setContext) {
            adapter.setContext("effect", context);
          }
          adapter.captureException(normalizeError(error));
        });
        return;
      }
      if (context && adapter.setContext) {
        adapter.setContext("effect", context);
      }
      adapter.captureException(normalizeError(error));
    });
  }),
  captureMessage: Effect.fn("captureMessage")(function* (message: string, level?: string) {
    yield* Effect.sync(() => adapter.captureMessage(message, level));
  }),
  withScope: Effect.fn("withScope")(function* <A>(fn: (scope: unknown) => A) {
    return yield* Effect.sync(() => (adapter.withScope ? adapter.withScope(fn) : fn(undefined)));
  }),
});

/**
 * Creates a telemetry layer from a user-supplied adapter.
 *
 * @category layers
 */
export const createTelemetryLayer = (
  adapter: TelemetryAdapter
): Layer.Layer<TelemetryService, never, never> =>
  Layer.succeed(TelemetryService, makeTelemetryService(adapter));
