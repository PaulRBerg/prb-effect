import { Layer } from "effect";
import { LocalStorageCursorStoreLive } from "./cursor-store/index.js";
import { BrowserStorageLive } from "./storage/index.js";
import type { LocalStorageTxStoreConfig } from "./tx-store/index.js";
import { makeLocalStorageTxStoreLive } from "./tx-store/index.js";
// import { TxPersistenceWithRehydrationLive } from "./tx-persistence/index.js";

export type BrowserPersistenceConfig = {
  namespace?: string; // For future namespacing support
  maxTxs?: number;
  ttlMs?: number;
};

/**
 * Create a CursorStore layer backed by browser localStorage.
 * Requires BrowserStorage to be provided.
 */
export const makeLocalStorageCursorStoreLayer = (_config?: { namespace?: string }) =>
  LocalStorageCursorStoreLive.pipe(Layer.provide(BrowserStorageLive));

/**
 * Create a TxStore layer backed by browser localStorage with configurable limits.
 * Requires BrowserStorage to be provided.
 */
export const makeLocalStorageTxStoreLayer = (config?: LocalStorageTxStoreConfig) =>
  makeLocalStorageTxStoreLive(config).pipe(Layer.provide(BrowserStorageLive));

/**
 * Combined browser persistence layer providing both cursor and transaction storage.
 * All storage is backed by browser localStorage.
 */
export const makeBrowserPersistenceLayer = (config?: BrowserPersistenceConfig) =>
  Layer.mergeAll(
    makeLocalStorageCursorStoreLayer(config),
    makeLocalStorageTxStoreLayer(config)
    // TxPersistence will be added when ready
  );
