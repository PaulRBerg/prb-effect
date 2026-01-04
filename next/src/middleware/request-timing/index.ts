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
export type RequestTimingOptions = {
  readonly now?: () => number;
  readonly onStart?: (context: RequestTimingStart) => Effect.Effect<void, never, never>;
  readonly onFinish?: (context: RequestTimingFinish) => Effect.Effect<void, never, never>;
};

/**
 * @category tags
 */
export class RequestTimingMiddleware extends Tag<RequestTimingMiddleware>()(
  "effect-next/RequestTimingMiddleware",
  { wrap: true }
) {}

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

  return Layer.succeed(
    RequestTimingMiddleware,
    RequestTimingMiddleware.of(({ next, props }) =>
      Effect.gen(function* () {
        const startTimeMs = now();
        yield* onStart({ props, startTimeMs });
        const exit = yield* Effect.exit(next);
        const endTimeMs = now();
        const durationMs = endTimeMs - startTimeMs;
        if (Exit.isSuccess(exit)) {
          yield* onFinish({
            durationMs,
            endTimeMs,
            props,
            startTimeMs,
            success: true,
          });
          return exit.value;
        }
        yield* onFinish({
          durationMs,
          endTimeMs,
          error: exit.cause,
          props,
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
