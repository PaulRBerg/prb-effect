// Allowance batching (approve + action as one Safe proposal)
export {
  buildSafeApproveTx,
  type SafeMultisigAllowAndWriteParams,
  type SafeMultisigApproveTxParams,
  safeMultisigAllowAndWrite,
} from "./allowance.js";
// Batch write (atomic multi-call via MultiSend)
export { safeMultisigBatchWrite } from "./batch.js";
// Detection
export type { SafeDetectionParams, SafeDetectionResult } from "./detection.js";
export { isSafeMultisig, SafeMultisigDetectionError } from "./detection.js";
// Errors
export {
  isMultiSendUnavailableError,
  NotInSafeAppContextError,
  OffchainSignatureTimeoutError,
  SafeAppsSdkUnavailableError,
  SafeMultiSendUnavailableError,
  SafeMultisigInfoUnavailableError,
  SafeMultisigSettingsError,
  SafeMultisigTxExecutionTimeoutError,
  SafeMultisigTxLookupError,
  SafeMultisigTxSubmissionError,
  SignTypedDataError,
} from "./errors.js";
// Service and layer
export { type SafeAppsServiceConfig, SafeAppsServiceLive } from "./live.js";
export { SafeAppsService, type SafeAppsServiceShape } from "./service.js";
// Simulation
export * from "./simulation/index.js";
// Transaction lifecycle (polling, status checks)
export {
  getSafeMultisigTxStatus,
  type SafeMultisigTxStatus,
  type SafeMultisigWaitOptions,
  type SafeMultisigWaitResult,
  waitForSafeMultisigTx,
} from "./tx-lifecycle.js";
// Types
export type {
  EIP712TypedData,
  OffchainSignaturePolicy,
  OffchainSignatureResult,
  SafeMultisigInfo,
  SafeMultisigTx,
  SafeMultisigTxResult,
  SafeMultisigTxSubmission,
  SafeWaitPolicy,
  SignTypedDataResult,
} from "./types.js";
