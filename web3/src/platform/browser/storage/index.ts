// Errors
export {
  StorageDecodeError,
  type StorageError,
  StorageQuotaExceededError,
  StorageUnavailableError,
} from "./errors.js";

// BrowserStorage service
export { BrowserStorage, BrowserStorageLive } from "./local-storage.js";
