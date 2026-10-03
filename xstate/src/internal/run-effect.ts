import { Cause, Effect, Option, Runtime } from "effect";

/** Preserve typed failures across the XState promise boundary and interrupt on actor stop. */
export async function runEffect<A, E>(
  effect: Effect.Effect<A, E>,
  signal: AbortSignal
): Promise<A> {
  try {
    return await Effect.runPromise(effect, { signal });
  } catch (error) {
    if (Runtime.isFiberFailure(error)) {
      const failure = Cause.failureOption(error[Runtime.FiberFailureCauseId]);
      if (Option.isSome(failure)) {
        throw failure.value;
      }
    }
    throw error;
  }
}
