/**
 * Test assertion helpers for effect-solana
 *
 * Provides type-safe utilities for asserting on Effect types in tests.
 */

import type { Context } from "effect";
import { Cause, Either, Exit, Layer, Option } from "effect";
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
    const error = Cause.failureOption(exit.cause);
    expect(Option.isSome(error)).toBe(true);
    if (Option.isSome(error)) {
      expect((error.value as { _tag: string })._tag).toBe(expectedTag);
    }
  }
};

/**
 * Type-safe assertion for Either.Left - returns the left value for further assertions
 *
 * @param either - The Either to assert on
 * @returns The left value for further assertions
 * @throws Error if Either is Right
 *
 * @example
 * ```typescript
 * const result = Either.left(new RpcError({ ... }));
 * const error = assertLeft(result);
 * expect(error._tag).toBe("RpcError");
 * ```
 */
export const assertLeft = <L, R>(either: Either.Either<R, L>): L => {
  expect(Either.isLeft(either)).toBe(true);
  if (!Either.isLeft(either)) {
    throw new Error("Expected Left");
  }
  return either.left;
};

/**
 * Type-safe assertion for Either.Right - returns the right value for further assertions
 *
 * @param either - The Either to assert on
 * @returns The right value for further assertions
 * @throws Error if Either is Left
 *
 * @example
 * ```typescript
 * const result = Either.right(1000000000n);
 * const value = assertRight(result);
 * expect(value).toBe(1000000000n);
 * ```
 */
export const assertRight = <L, R>(either: Either.Either<R, L>): R => {
  expect(Either.isRight(either)).toBe(true);
  if (!Either.isRight(either)) {
    throw new Error("Expected Right");
  }
  return either.right;
};

/**
 * Generic factory for creating mock service layers.
 * Eliminates boilerplate by abstracting the common pattern of:
 * 1. Merging default config with overrides
 * 2. Mapping merged config to service shape
 * 3. Creating a Layer.succeed
 *
 * @param ServiceTag - The Effect Context.Tag for the service
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
  ServiceTag: Context.Tag<I, S>,
  defaults: C,
  config: Partial<C>,
  mapToShape: (merged: C) => S
): Layer.Layer<I> => {
  const merged = { ...defaults, ...config } as C;
  const serviceShape = mapToShape(merged);
  return Layer.succeed(ServiceTag, ServiceTag.of(serviceShape));
};
