import { Duration, Effect, Option } from "effect";

/**
 * Poll an effect until it returns Some, with timeout.
 *
 * @param attempt - Effect that returns Option.some when done, Option.none to continue polling
 * @param options - Polling configuration (interval/timeout in milliseconds)
 * @param onTimeout - Factory for timeout error, receives elapsed timeout
 */
export const pollUntil = <T, E1, E2, R>(
  attempt: Effect.Effect<Option.Option<T>, E1, R>,
  options: { interval: number; timeout: number },
  onTimeout: (elapsed: number) => E2
): Effect.Effect<T, E1 | E2, R> =>
  Effect.gen(function* () {
    let result: T | null = null;

    const pollLoop = Effect.gen(function* () {
      while (result === null) {
        const maybeResult = yield* attempt;
        if (Option.isSome(maybeResult)) {
          result = maybeResult.value;
        } else {
          // Effect.sleep is interruptible
          yield* Effect.sleep(Duration.millis(options.interval));
        }
      }
    });

    yield* pollLoop.pipe(
      Effect.timeout(Duration.millis(options.timeout)),
      Effect.catchTag("TimeoutException", () => Effect.fail(onTimeout(options.timeout)))
    );

    // After timeout handling, result should be set if we didn't fail
    if (result === null) {
      return yield* Effect.fail(onTimeout(options.timeout));
    }

    return result;
  });
