/**
 */

import type { AsyncLocalStorage as AsyncLocalStorageType } from "node:async_hooks";
import * as Context_ from "effect/Context";

/**
 * @category models
 */
export type CapturedContext = {
  readonly workStore: unknown;
  readonly workUnitStore: unknown;
};

/**
 * @category models
 */
export type AsyncStorageDeps = {
  readonly workAsyncStorage: AsyncLocalStorageType<unknown>;
  readonly workUnitAsyncStorage: AsyncLocalStorageType<unknown>;
};

/**
 * Captures the current AsyncLocalStorage context for both work and workUnit stores.
 *
 * @category utils
 */
export const captureContext = (deps: AsyncStorageDeps): CapturedContext => ({
  workStore: deps.workAsyncStorage.getStore(),
  workUnitStore: deps.workUnitAsyncStorage.getStore(),
});

/**
 * Wraps a function to restore AsyncLocalStorage context when executed.
 *
 * @category utils
 */
export const withRestoredContext =
  <Args extends readonly unknown[], R>(
    context: CapturedContext,
    deps: AsyncStorageDeps,
    fn: (...args: Args) => R
  ): ((...args: Args) => R) =>
  (...args: Args): R => {
    const { workStore, workUnitStore } = context;
    const { workAsyncStorage, workUnitAsyncStorage } = deps;

    if (workStore !== undefined && workUnitStore !== undefined) {
      return workAsyncStorage.run(workStore, () =>
        workUnitAsyncStorage.run(workUnitStore, () => fn(...args))
      );
    }

    if (workStore !== undefined) {
      return workAsyncStorage.run(workStore, () => fn(...args));
    }

    if (workUnitStore !== undefined) {
      return workUnitAsyncStorage.run(workUnitStore, () => fn(...args));
    }

    return fn(...args);
  };

/**
 * Creates a context wrapper function that can restore AsyncLocalStorage context.
 *
 * @category utils
 */
export const createContextWrapper =
  (context: CapturedContext, deps: AsyncStorageDeps) =>
  <Args extends readonly unknown[], R>(fn: (...args: Args) => R): ((...args: Args) => R) =>
    withRestoredContext(context, deps, fn);

/**
 * @category models
 */
export type ContextWrapper = ReturnType<typeof createContextWrapper>;

/**
 * Service tag for accessing the context wrapper in Effect programs.
 *
 * @category tags
 */
export class ContextWrapperService extends Context_.Tag("ContextWrapperService")<
  ContextWrapperService,
  ContextWrapper
>() {}
