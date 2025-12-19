/**
 * @since 1.0.0
 */
import { Cause, Chunk, Effect, Exit } from "effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import { unstable_rethrow } from "next/dist/client/components/unstable-rethrow.server.js";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external.js";
import { NotFoundError, RedirectError } from "../navigation/index.js";
import * as AsyncContext from "./async-context.js";

/**
 * Executes an Effect program with Next.js AsyncLocalStorage context preservation
 * and returns the Exit directly without throwing.
 *
 * This function:
 * 1. Captures the current Next.js AsyncLocalStorage context
 * 2. Provides a context wrapper service to the Effect program
 * 3. Runs the Effect using the provided runtime (or default runtime)
 * 4. Returns the Exit for manual error handling
 *
 * @since 1.0.0
 * @category utils
 * @internal
 */
export function executeWithRuntimeExit<A, E>(
  runtime: undefined,
  effect: Effect.Effect<A, E, AsyncContext.ContextWrapperService>
): Promise<Exit.Exit<A, E>>;
export function executeWithRuntimeExit<A, E, R, ER>(
  runtime: ManagedRuntime.ManagedRuntime<R, ER>,
  effect: Effect.Effect<A, E, R | AsyncContext.ContextWrapperService>
): Promise<Exit.Exit<A, E | ER>>;
export async function executeWithRuntimeExit<A, E, R, ER>(
  runtime: ManagedRuntime.ManagedRuntime<R, ER> | undefined,
  effect: Effect.Effect<A, E, R | AsyncContext.ContextWrapperService>
): Promise<Exit.Exit<A, E | ER>> {
  const asyncStorageDeps: AsyncContext.AsyncStorageDeps = {
    workAsyncStorage,
    workUnitAsyncStorage,
  };
  const capturedContext = AsyncContext.captureContext(asyncStorageDeps);
  const wrapWithContext = AsyncContext.createContextWrapper(capturedContext, asyncStorageDeps);

  const effect_ = effect.pipe(
    Effect.provideService(AsyncContext.ContextWrapperService, wrapWithContext)
  ) as Effect.Effect<A, E, R>;

  return runtime
    ? await runtime.runPromiseExit(effect_)
    : await Effect.runPromiseExit(effect_ as Effect.Effect<A, E, never>);
}

/**
 * Executes an Effect program with Next.js AsyncLocalStorage context preservation.
 *
 * This function:
 * 1. Captures the current Next.js AsyncLocalStorage context
 * 2. Provides a context wrapper service to the Effect program
 * 3. Runs the Effect using the provided runtime (or default runtime)
 * 4. Handles errors and defects appropriately for Next.js
 *
 * @since 1.0.0
 * @category utils
 */
export function executeWithRuntime<A, E>(
  runtime: undefined,
  effect: Effect.Effect<A, E, AsyncContext.ContextWrapperService>
): Promise<A>;
export function executeWithRuntime<A, E, R, ER>(
  runtime: ManagedRuntime.ManagedRuntime<R, ER>,
  effect: Effect.Effect<A, E, R | AsyncContext.ContextWrapperService>
): Promise<A>;
export async function executeWithRuntime<A, E, R, ER>(
  runtime: ManagedRuntime.ManagedRuntime<R, ER> | undefined,
  effect: Effect.Effect<A, E, R | AsyncContext.ContextWrapperService>
): Promise<A> {
  const result = runtime
    ? await executeWithRuntimeExit(runtime, effect)
    : await executeWithRuntimeExit(
        undefined,
        effect as Effect.Effect<A, E, AsyncContext.ContextWrapperService>
      );

  if (Exit.isFailure(result)) {
    const defects = Chunk.toArray(Cause.defects(result.cause));
    if (defects.length === 1) {
      unstable_rethrow(defects[0]);
    }

    // Handle navigation errors by triggering Next.js
    // Use dynamic import to avoid loading React at module initialization (breaks tests)
    const failures = Chunk.toArray(Cause.failures(result.cause));
    const navigationError = failures.find(
      (f) => f instanceof NotFoundError || f instanceof RedirectError
    );

    if (navigationError instanceof NotFoundError) {
      const { notFound } = await import("next/navigation.js");
      notFound();
    } else if (navigationError instanceof RedirectError) {
      const { redirect, permanentRedirect } = await import("next/navigation.js");
      if (navigationError.type === "permanent") {
        permanentRedirect(navigationError.url);
      } else {
        redirect(navigationError.url);
      }
    }

    const errors = Cause.prettyErrors(result.cause);

    throw errors[0];
  }

  return result.value;
}
