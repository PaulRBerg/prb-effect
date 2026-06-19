import "server-only";

import { Effect, Exit, Layer } from "effect";
import { Tag } from "../index.js";

/**
 * @category models
 */
export type RequestTimingStart = {
  readonly props: unknown;
  readonly startTimeMs: number;
};

/**
 * @category models
 */
export type RequestTimingFinish = RequestTimingStart & {
  readonly endTimeMs: number;
  readonly durationMs: number;
  readonly success: boolean;
  readonly error?: unknown;
};

/**
 * @category models
 */
export type RequestTimingShouldRecord = {
  readonly props: unknown;
};

/**
 * @category models
 */
export type RequestTimingOptions = {
  readonly now?: () => number;
  readonly onStart?: (context: RequestTimingStart) => Effect.Effect<void, never, never>;
  readonly onFinish?: (context: RequestTimingFinish) => Effect.Effect<void, never, never>;
  readonly random?: () => number;
  readonly sampleRate?: number;
  readonly shouldRecord?: (
    context: RequestTimingShouldRecord
  ) => Effect.Effect<boolean, never, never>;
  readonly redactProps?: (props: unknown) => unknown;
};

/**
 * @category tags
 */
export class RequestTimingMiddleware extends Tag<RequestTimingMiddleware>()(
  "effect-next/RequestTimingMiddleware",
  { wrap: true }
) {}

const clampSampleRate = (input: number | undefined): number => {
  const sampleRate = input ?? 1;
  return Number.isFinite(sampleRate) ? Math.max(0, Math.min(1, sampleRate)) : 1;
};

/**
 * Creates a request timing middleware layer.
 *
 * @category layers
 */
export const makeRequestTimingMiddleware = (
  options?: RequestTimingOptions
): Layer.Layer<RequestTimingMiddleware, never, never> => {
  const now = options?.now ?? (() => Date.now());
  const onStart = options?.onStart ?? (() => Effect.logDebug("Request started"));
  const onFinish =
    options?.onFinish ??
    ((context) => Effect.logDebug(`Request completed in ${context.durationMs}ms`));
  const random = options?.random ?? Math.random;
  const sampleRate = clampSampleRate(options?.sampleRate);
  const shouldRecord = options?.shouldRecord ?? (() => Effect.succeed(true));
  const redactProps = options?.redactProps ?? ((props: unknown) => props);

  return Layer.succeed(
    RequestTimingMiddleware,
    RequestTimingMiddleware.of(({ next, props }) =>
      Effect.gen(function* () {
        if (sampleRate <= 0 || (sampleRate < 1 && random() >= sampleRate)) {
          return yield* next;
        }

        const shouldRecordRequest = yield* shouldRecord({ props });
        if (!shouldRecordRequest) {
          return yield* next;
        }

        const recordedProps = redactProps(props);
        const startTimeMs = now();
        yield* onStart({ props: recordedProps, startTimeMs });
        const exit = yield* Effect.exit(next);
        const endTimeMs = now();
        const durationMs = endTimeMs - startTimeMs;
        if (Exit.isSuccess(exit)) {
          yield* onFinish({
            durationMs,
            endTimeMs,
            props: recordedProps,
            startTimeMs,
            success: true,
          });
          return exit.value;
        }
        yield* onFinish({
          durationMs,
          endTimeMs,
          error: exit.cause,
          props: recordedProps,
          startTimeMs,
          success: false,
        });
        return yield* Effect.failCause(exit.cause);
      })
    )
  );
};

/**
 * Default request timing middleware layer.
 *
 * @category layers
 */
export const RequestTimingMiddlewareLive = makeRequestTimingMiddleware();
