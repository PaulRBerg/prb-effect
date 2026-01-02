/**
 * Test assertion helpers for effect-evm
 *
 * Provides type-safe utilities for asserting on Effect types in tests.
 */

import type { Context } from "effect";
import { Cause, Effect, Either, Exit, Layer, Option } from "effect";
import { expect } from "vitest";
import { ClientNotFoundError, WalletNotConnectedError } from "@/src/core/index.js";

/**
 * Assert an Exit is a failure with a specific tagged error
 *
 * @param exit - The Exit to assert on
 * @param expectedTag - The expected error tag
 *
 * @example
 * ```typescript
 * const exit = yield* Effect.exit(someEffect);
 * expectTaggedFailure(exit, "ClientNotFoundError");
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
 * const result = Either.left(new Error("boom"));
 * const error = assertLeft(result);
 * expect(error.message).toBe("boom");
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
 * const result = Either.right(42);
 * const value = assertRight(result);
 * expect(value).toBe(42);
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
 * Creates a chainId-gated getter for mock services.
 * Returns the value if chainId matches, otherwise fails with ClientNotFoundError.
 *
 * @param supportedChainId - The chainId this mock supports
 * @param getValue - Function that returns the value when chainId matches
 * @returns A function that takes a chainId and returns an Effect
 *
 * @example
 * ```typescript
 * const mockClient = { chain: { id: 1 }, ... };
 * const get = makeChainIdGetter(1, () => mockClient);
 * // get(1) => Effect.succeed(mockClient)
 * // get(2) => Effect.fail(ClientNotFoundError)
 * ```
 */
export const makeChainIdGetter =
  <A>(supportedChainId: number, getValue: () => A) =>
  (chainId: number) =>
    chainId === supportedChainId
      ? Effect.succeed(getValue())
      : Effect.fail(
          new ClientNotFoundError({
            chainId,
            message: `No client configured for chain ID ${chainId}`,
          })
        );

/**
 * Generic chain validation helper that accepts a custom error factory.
 * This is the base implementation used by withChainIdCheck and withWalletChainIdCheck.
 *
 * @param supportedChainId - The chainId this mock supports
 * @param errorFactory - Function to create the error when chainId doesn't match
 * @param fn - Function to call if chainId matches
 * @returns A wrapped function that validates chainId first
 *
 * @example
 * ```typescript
 * const withCustomCheck = <P extends { chainId: number }, A, E>(
 *   supportedChainId: number,
 *   fn: (params: P) => Effect.Effect<A, E>
 * ) => withChainCheck(supportedChainId, (chainId) => new CustomError({ chainId }), fn);
 * ```
 */
export const withChainCheck =
  <P extends { chainId: number }, A, E, Err>(
    supportedChainId: number,
    errorFactory: (chainId: number, message: string) => Err,
    fn: (params: P) => Effect.Effect<A, E>
  ): ((params: P) => Effect.Effect<A, E | Err>) =>
  (params) =>
    params.chainId === supportedChainId
      ? fn(params)
      : Effect.fail(
          errorFactory(
            params.chainId,
            `Chain ${params.chainId} not supported. Only chain ${supportedChainId} is configured.`
          )
        );

/**
 * Wraps a function that takes params with chainId to validate chain support first.
 * If chainId matches, calls the function; otherwise fails with ClientNotFoundError.
 *
 * @param supportedChainId - The chainId this mock supports
 * @param fn - Function to call if chainId matches
 * @returns A wrapped function that validates chainId first
 *
 * @example
 * ```typescript
 * const getBlock = (params: { chainId: number }) => Effect.succeed(mockBlock);
 * const wrapped = withChainIdCheck(1, getBlock);
 * // wrapped({ chainId: 1 }) => Effect.succeed(mockBlock)
 * // wrapped({ chainId: 2 }) => Effect.fail(ClientNotFoundError)
 * ```
 */
export const withChainIdCheck = <P extends { chainId: number }, A, E>(
  supportedChainId: number,
  fn: (params: P) => Effect.Effect<A, E>
): ((params: P) => Effect.Effect<A, E | ClientNotFoundError>) =>
  withChainCheck(
    supportedChainId,
    (chainId) =>
      new ClientNotFoundError({
        chainId,
        message: `No client configured for chain ID ${chainId}`,
      }),
    fn
  );

/**
 * Creates a chainId-gated getter for mock wallet services.
 * Returns the value if chainId matches, otherwise fails with WalletNotConnectedError.
 *
 * @param supportedChainId - The chainId this mock supports
 * @param getValue - Function that returns the value when chainId matches
 * @returns A function that takes a chainId and returns an Effect
 *
 * @example
 * ```typescript
 * const mockWallet = { account: { address: "0x..." }, ... };
 * const get = makeWalletChainIdGetter(1, () => mockWallet);
 * // get(1) => Effect.succeed(mockWallet)
 * // get(2) => Effect.fail(WalletNotConnectedError)
 * ```
 */
export const makeWalletChainIdGetter =
  <A>(supportedChainId: number, getValue: () => A) =>
  (chainId: number) =>
    chainId === supportedChainId
      ? Effect.succeed(getValue())
      : Effect.fail(
          new WalletNotConnectedError({
            chainId,
            message: `No wallet client connected for chain ID ${chainId}`,
          })
        );

/**
 * Wraps a function that takes params with chainId to validate wallet chain support first.
 * If chainId matches, calls the function; otherwise fails with WalletNotConnectedError.
 *
 * @param supportedChainId - The chainId this mock wallet supports
 * @param fn - Function to call if chainId matches
 * @returns A wrapped function that validates chainId first
 *
 * @example
 * ```typescript
 * const writeContract = (params: { chainId: number, ... }) => Effect.succeed(mockHash);
 * const wrapped = withWalletChainIdCheck(1, writeContract);
 * // wrapped({ chainId: 1, ... }) => Effect.succeed(mockHash)
 * // wrapped({ chainId: 2, ... }) => Effect.fail(WalletNotConnectedError)
 * ```
 */
export const withWalletChainIdCheck = <P extends { chainId: number }, A, E>(
  supportedChainId: number,
  fn: (params: P) => Effect.Effect<A, E>
): ((params: P) => Effect.Effect<A, E | WalletNotConnectedError>) =>
  withChainCheck(
    supportedChainId,
    (chainId) =>
      new WalletNotConnectedError({
        chainId,
        message: `No wallet client connected for chain ID ${chainId}`,
      }),
    fn
  );

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
 * // In a mock service file:
 * export const makeMockGasServiceLayer = (
 *   config: MockGasServiceConfig = {},
 *   supportedChainId = 1
 * ): Layer.Layer<GasService> => {
 *   const defaults = {
 *     estimateFees: () => Effect.succeed(DEFAULT_FEE_ESTIMATE),
 *     getBaseFee: () => Effect.succeed(30000000000n),
 *     // ... other defaults
 *   };
 *
 *   return makeMockServiceLayer(
 *     GasService,
 *     defaults,
 *     config,
 *     (merged) => ({
 *       estimateFees: withChainIdCheck(supportedChainId, merged.estimateFees),
 *       getBaseFee: withChainIdCheck(supportedChainId, merged.getBaseFee),
 *       // ... other methods
 *     })
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
