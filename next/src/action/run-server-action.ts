import "server-only";
import type { Effect } from "effect";
import { Cause, Chunk, Exit } from "effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import { executeWithRuntime, executeWithRuntimeExit } from "../internal/executor.js";
import type { ServerActionResult } from "./types.js";
import { ServerActionError } from "./types.js";

/**
 * Helper to extract error tag from Effect errors.
 */
function getErrorTag(error: unknown): string | null {
  if (error && typeof error === "object" && "_tag" in error) {
    return String(error._tag);
  }
  return null;
}

/**
 * Runs a server action and returns a discriminated union result.
 * This is safe to call from client components as it never throws.
 */
export async function runServerAction<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: { runtime?: ManagedRuntime.ManagedRuntime<R, never> }
): Promise<ServerActionResult<A>> {
  const exit = options?.runtime
    ? await executeWithRuntimeExit(options.runtime, effect)
    : await executeWithRuntimeExit(undefined, effect as Effect.Effect<A, E, never>);

  if (Exit.isSuccess(exit)) {
    return { data: exit.value, success: true };
  }

  // Extract first failure from cause chain for error tag
  const failures = Cause.failures(exit.cause);
  const firstError = Chunk.isEmpty(failures) ? null : Chunk.unsafeHead(failures);

  // Get full error message from cause (includes stack traces, all errors)
  const prettyErrors = Cause.prettyErrors(exit.cause);
  const message = prettyErrors[0]?.message ?? "Unknown error";

  return {
    error: new ServerActionError({
      errorTag: getErrorTag(firstError),
      message,
    }),
    success: false,
  };
}

/**
 * Runs a server action and throws on failure.
 * Use this in Server Components where throwing is acceptable.
 */
export function runServerActionOrThrow<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: { runtime?: ManagedRuntime.ManagedRuntime<R, never> }
): Promise<A> {
  return options?.runtime
    ? executeWithRuntime(options.runtime, effect)
    : executeWithRuntime(undefined, effect as Effect.Effect<A, E, never>);
}
