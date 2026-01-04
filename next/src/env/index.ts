import "server-only";

import { Effect } from "effect";

/**
 * @category models
 */
export type Environment = "development" | "production" | "test";

/**
 * @category models
 */
export type EnvironmentResolver = () => string | undefined;

const validEnvironments: readonly Environment[] = ["development", "production", "test"];

const isValidEnvironment = (value: string): value is Environment =>
  validEnvironments.includes(value as Environment);

const defaultResolver: EnvironmentResolver = () => process.env.NODE_ENV;

/**
 * Resolves the current environment using NODE_ENV or a custom resolver.
 *
 * @category utils
 */
export const resolveEnvironment = (
  resolver: EnvironmentResolver = defaultResolver
): Environment => {
  const raw = resolver() ?? "development";
  return isValidEnvironment(raw) ? raw : "development";
};

/**
 * Effect that resolves the current environment.
 *
 * @category utils
 */
export const getEnvironment = (
  resolver?: EnvironmentResolver
): Effect.Effect<Environment, never, never> => Effect.sync(() => resolveEnvironment(resolver));

/**
 * Resolves the current environment synchronously.
 *
 * @category utils
 */
export const getEnvironmentSync = (resolver?: EnvironmentResolver): Environment =>
  resolveEnvironment(resolver);

/**
 * @category utils
 */
export const isDevelopment = (resolver?: EnvironmentResolver): boolean =>
  resolveEnvironment(resolver) === "development";

/**
 * @category utils
 */
export const isProduction = (resolver?: EnvironmentResolver): boolean =>
  resolveEnvironment(resolver) === "production";

/**
 * @category utils
 */
export const isTest = (resolver?: EnvironmentResolver): boolean =>
  resolveEnvironment(resolver) === "test";
