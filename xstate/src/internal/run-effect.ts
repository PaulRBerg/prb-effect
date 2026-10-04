import { Effect } from "effect";

/** Preserve typed failures across the XState promise boundary and interrupt on actor stop. */
export function runEffect<A, E>(effect: Effect.Effect<A, E>, signal: AbortSignal): Promise<A> {
  return Effect.runPromise(effect, { signal });
}
