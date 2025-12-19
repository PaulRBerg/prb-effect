/**
 * Test helper functions for working with Effect types in tests.
 *
 * @module testing-kit/helpers
 */

import type { Layer } from "effect";
import { Cause, Chunk, Effect, Exit, ManagedRuntime } from "effect";

/**
 * Asserts that an Exit is a success and returns the value.
 * Throws if the Exit is a failure.
 *
 * @param exit - Exit to check
 * @returns The success value
 * @throws Error if Exit is a failure
 *
 * @example
 * ```ts
 * const exit = await Effect.runPromiseExit(Effect.succeed(42));
 * const value = assertRight(exit); // 42
 * ```
 */
export function assertRight<E, A>(exit: Exit.Exit<A, E>): A {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failures = Chunk.toArray(Cause.failures(exit.cause));
  const defects = Chunk.toArray(Cause.defects(exit.cause));
  const message = [
    "Expected Success but got Failure",
    failures.length > 0 && `Failures: ${failures.map((f) => JSON.stringify(f)).join(", ")}`,
    defects.length > 0 && `Defects: ${defects.map((d) => String(d)).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  throw new Error(message);
}

/**
 * Asserts that an Exit is a failure and returns the first error.
 * Throws if the Exit is a success.
 *
 * @param exit - Exit to check
 * @returns The first failure error
 * @throws Error if Exit is a success or has no failures
 *
 * @example
 * ```ts
 * const exit = await Effect.runPromiseExit(Effect.fail("error"));
 * const error = assertLeft(exit); // "error"
 * ```
 */
export function assertLeft<E, A>(exit: Exit.Exit<A, E>): E {
  if (Exit.isFailure(exit)) {
    const failures = Chunk.toArray(Cause.failures(exit.cause));
    if (failures.length > 0) {
      return failures[0];
    }
    const defects = Chunk.toArray(Cause.defects(exit.cause));
    throw new Error(
      `Expected Left with failures but got defects: ${defects.map((d) => String(d)).join(", ")}`
    );
  }
  throw new Error(`Expected Failure but got Success: ${JSON.stringify(exit.value)}`);
}

/**
 * Expects an Exit to be a failure with a specific tagged error.
 * Throws if the Exit is a success or the error doesn't match the tag.
 *
 * @param exit - Exit to check
 * @param tag - Expected _tag value on the error
 * @throws Error if Exit is not a failure with the expected tag
 *
 * @example
 * ```ts
 * const exit = await Effect.runPromiseExit(
 *   Effect.fail({ _tag: "NotFound" as const, message: "User not found" })
 * );
 * expectTaggedFailure(exit, "NotFound"); // Passes
 * expectTaggedFailure(exit, "Unauthorized"); // Throws
 * ```
 */
export function expectTaggedFailure<E extends { _tag: string }>(
  exit: Exit.Exit<unknown, E>,
  tag: E["_tag"]
): void {
  if (!Exit.isFailure(exit)) {
    throw new Error(`Expected failure with tag "${tag}" but got success`);
  }

  const failures = Chunk.toArray(Cause.failures(exit.cause));
  if (failures.length === 0) {
    const defects = Chunk.toArray(Cause.defects(exit.cause));
    throw new Error(
      `Expected failure with tag "${tag}" but got defects: ${defects.map((d) => String(d)).join(", ")}`
    );
  }

  const error = failures[0];
  if (!("_tag" in error) || error._tag !== tag) {
    throw new Error(
      `Expected failure with tag "${tag}" but got "${("_tag" in error && String(error._tag)) || "no _tag"}"`
    );
  }
}

/**
 * Expects an Exit to contain a specific defect.
 * Useful for testing unexpected errors.
 *
 * @param exit - Exit to check
 * @param predicate - Function to test if a defect matches expectations
 * @throws Error if Exit has no matching defect
 *
 * @example
 * ```ts
 * const exit = await Effect.runPromiseExit(Effect.die(new Error("Boom!")));
 * expectDefect(exit, (d) => d instanceof Error && d.message === "Boom!");
 * ```
 */
export function expectDefect<E, A>(
  exit: Exit.Exit<A, E>,
  predicate: (defect: unknown) => boolean
): void {
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected failure with defect but got success");
  }

  const defects = Chunk.toArray(Cause.defects(exit.cause));
  if (defects.length === 0) {
    throw new Error("Expected defect but got failure without defects");
  }

  const hasMatchingDefect = defects.some(predicate);
  if (!hasMatchingDefect) {
    throw new Error(
      `No defect matched predicate. Defects: ${defects.map((d) => String(d)).join(", ")}`
    );
  }
}

/**
 * Runs an Effect and returns the result, throwing if it fails.
 * Useful for test setup where you expect success.
 *
 * @param effect - Effect to run
 * @param runtime - Optional ManagedRuntime to use
 * @returns Promise of the success value
 * @throws If the Effect fails
 *
 * @example
 * ```ts
 * // In a test setup
 * const user = await runExpectSuccess(createTestUser());
 * ```
 */
export async function runExpectSuccess<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtime?: ManagedRuntime.ManagedRuntime<R, never>
): Promise<A> {
  const exit = runtime
    ? await runtime.runPromiseExit(effect)
    : await Effect.runPromiseExit(effect as Effect.Effect<A, E, never>);
  return assertRight(exit);
}

/**
 * Runs an Effect and returns the error, throwing if it succeeds.
 * Useful for testing error cases.
 *
 * @param effect - Effect to run
 * @param runtime - Optional ManagedRuntime to use
 * @returns Promise of the failure error
 * @throws If the Effect succeeds
 *
 * @example
 * ```ts
 * const error = await runExpectFailure(
 *   Effect.fail({ _tag: "NotFound", message: "Not found" })
 * );
 * expect(error._tag).toBe("NotFound");
 * ```
 */
export async function runExpectFailure<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runtime?: ManagedRuntime.ManagedRuntime<R, never>
): Promise<E> {
  const exit = runtime
    ? await runtime.runPromiseExit(effect)
    : await Effect.runPromiseExit(effect as Effect.Effect<A, E, never>);
  return assertLeft(exit);
}

/**
 * Creates a ManagedRuntime for testing with a specific layer.
 *
 * @param layer - Layer to provide to the runtime
 * @returns ManagedRuntime with the layer
 *
 * @example
 * ```ts
 * const runtime = makeMockRuntime(TestLayer);
 * const result = await runtime.runPromise(myEffect);
 * ```
 */
export function makeMockRuntime<R, E>(
  layer: Layer.Layer<R, E, never>
): ManagedRuntime.ManagedRuntime<R, E> {
  return ManagedRuntime.make(layer);
}
