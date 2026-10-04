/**
 * Test assertion helpers for effect-solana
 *
 * Provides type-safe utilities for asserting on Effect types in tests.
 */

import type { Context } from "effect";
import { Cause, Exit, Layer, Option, Result } from "effect";
import { expect } from "vitest";

/**
 * Assert an Exit is a failure with a specific tagged error
 *
 * @param exit - The Exit to assert on
 * @param expectedTag - The expected error tag
 *
 * @example
 * ```typescript
 * const exit = yield* Effect.exit(someEffect);
 * expectTaggedFailure(exit, "RpcError");
 * ```
 */
export const expectTaggedFailure = <E extends { _tag: string }>(
  exit: Exit.Exit<unknown, E>,
  expectedTag: E["_tag"]
): void => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const error = Cause.findErrorOption(exit.cause);
    expect(Option.isSome(error)).toBe(true);
    if (Option.isSome(error)) {
      expect((error.value as { _tag: string })._tag).toBe(expectedTag);
    }
  }
};

/**
 * Type-safe assertion for Result.Failure - returns the failure value for further assertions
 *
 * @param result - The Result to assert on
 * @returns The failure value for further assertions
 * @throws Error if Result is Success
 *
 * @example
 * ```typescript
 * const result = Result.fail(new RpcError({ ... }));
 * const error = assertFailure(result);
 * expect(error._tag).toBe("RpcError");
 * ```
 */
export const assertFailure = <L, R>(result: Result.Result<R, L>): L => {
  expect(Result.isFailure(result)).toBe(true);
  if (!Result.isFailure(result)) {
    throw new Error("Expected Failure");
  }
  return result.failure;
};

/**
 * Type-safe assertion for Result.Success - returns the success value for further assertions
 *
 * @param result - The Result to assert on
 * @returns The success value for further assertions
 * @throws Error if Result is Failure
 *
 * @example
 * ```typescript
 * const result = Result.succeed(1000000000n);
 * const value = assertSuccess(result);
 * expect(value).toBe(1000000000n);
 * ```
 */
export const assertSuccess = <L, R>(result: Result.Result<R, L>): R => {
  expect(Result.isSuccess(result)).toBe(true);
  if (!Result.isSuccess(result)) {
    throw new Error("Expected Success");
  }
  return result.success;
};

/**
 * Generic factory for creating mock service layers.
 * Eliminates boilerplate by abstracting the common pattern of:
 * 1. Merging default config with overrides
 * 2. Mapping merged config to service shape
 * 3. Creating a Layer.succeed
 *
 * @param ServiceTag - The Effect Context.Service for the service
 * @param defaults - Default configuration object
 * @param config - Partial configuration to override defaults
 * @param mapToShape - Function that maps merged config to the service shape
 * @returns A Layer providing the service
 *
 * @example
 * ```typescript
 * export const makeMockBalanceServiceLayer = (
 *   config: MockBalanceServiceConfig = {}
 * ): Layer.Layer<BalanceService> => {
 *   const defaults = {
 *     getSolBalance: () => Effect.succeed(1000000000n),
 *   };
 *
 *   return makeMockServiceLayer(
 *     BalanceService,
 *     defaults,
 *     config,
 *     (merged) => merged
 *   );
 * };
 * ```
 */
export const makeMockServiceLayer = <I, S, C extends Record<string, unknown>>(
  ServiceTag: Context.Key<I, S>,
  defaults: C,
  config: Partial<C>,
  mapToShape: (merged: C) => S
): Layer.Layer<I> => {
  const merged = { ...defaults, ...config } as C;
  const serviceShape = mapToShape(merged);
  return Layer.succeed(ServiceTag, serviceShape);
};
