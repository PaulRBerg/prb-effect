import { Context, Effect, Layer } from "effect";
import type { StorageError } from "./errors.js";
import {
  StorageDecodeError,
  StorageQuotaExceededError,
  StorageUnavailableError,
} from "./errors.js";

/**
 * Service interface for browser storage operations.
 * Provides a safe, Effect-based API for localStorage access.
 */
export type BrowserStorage = {
  /**
   * Retrieve a value from storage by key.
   * Returns null if the key does not exist.
   */
  readonly get: (key: string) => Effect.Effect<string | null, StorageError>;

  /**
   * Store a value in storage under the given key.
   */
  readonly set: (key: string, value: string) => Effect.Effect<void, StorageError>;

  /**
   * Remove a value from storage by key.
   */
  readonly remove: (key: string) => Effect.Effect<void, StorageError>;
};

/**
 * Context tag for the BrowserStorage service.
 */
export const BrowserStorage = Context.Service<BrowserStorage>("ew3/BrowserStorage");

/**
 * Check if localStorage is available in the current environment.
 */
const isStorageAvailable = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

/**
 * Live implementation of BrowserStorage using the browser's localStorage API.
 */
export const BrowserStorageLive = Layer.succeed(
  BrowserStorage,
  BrowserStorage.of({
    get: (key: string) =>
      Effect.try({
        catch: (error) => {
          if (error instanceof StorageUnavailableError) {
            return error;
          }
          if (error instanceof Error && error.name === "SecurityError") {
            return new StorageUnavailableError({
              message: `localStorage access denied: ${error.message}`,
            });
          }
          return new StorageDecodeError({
            cause: error,
            key,
            message: "Failed to retrieve value from localStorage",
          });
        },
        try: () => {
          if (!isStorageAvailable()) {
            throw new StorageUnavailableError({
              message: "localStorage is not available (SSR or blocked by browser)",
            });
          }
          return window.localStorage.getItem(key);
        },
      }),

    remove: (key: string) =>
      Effect.try({
        catch: (error) => {
          if (error instanceof StorageUnavailableError) {
            return error;
          }
          if (error instanceof Error && error.name === "SecurityError") {
            return new StorageUnavailableError({
              message: `localStorage access denied: ${error.message}`,
            });
          }
          return new StorageDecodeError({
            cause: error,
            key,
            message: "Failed to remove value from localStorage",
          });
        },
        try: () => {
          if (!isStorageAvailable()) {
            throw new StorageUnavailableError({
              message: "localStorage is not available (SSR or blocked by browser)",
            });
          }
          window.localStorage.removeItem(key);
        },
      }),

    set: (key: string, value: string) =>
      Effect.try({
        catch: (error) => {
          if (error instanceof StorageUnavailableError) {
            return error;
          }
          if (
            error instanceof Error &&
            (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
          ) {
            return new StorageQuotaExceededError({
              key,
              message: "Storage quota exceeded",
            });
          }
          if (error instanceof Error && error.name === "SecurityError") {
            return new StorageUnavailableError({
              message: `localStorage access denied: ${error.message}`,
            });
          }
          return new StorageDecodeError({
            cause: error,
            key,
            message: "Failed to store value in localStorage",
          });
        },
        try: () => {
          if (!isStorageAvailable()) {
            throw new StorageUnavailableError({
              message: "localStorage is not available (SSR or blocked by browser)",
            });
          }
          window.localStorage.setItem(key, value);
        },
      }),
  })
);
