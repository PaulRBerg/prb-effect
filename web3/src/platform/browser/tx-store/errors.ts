import type { StorageError } from "../storage/index.js";

/**
 * Union type of all TxStore errors.
 * Re-exports storage errors since TxStore depends on the storage layer.
 */
export type TxStoreError = StorageError;
