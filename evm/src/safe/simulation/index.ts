// Errors

// ABIs (for advanced usage)
export { safeAbis } from "./abis.js";
// Address utilities
export {
  getMultiSendAddress,
  getSimulateAccessorAddress,
} from "./addresses.js";
// Encoding utilities
export { decodeSimulationData, encodeMultiSend } from "./encoding.js";
export {
  GasLimitOverflowError,
  InvalidGasThresholdError,
  SafeContractsNotDeployedError,
  SafeSimulationFailedError,
  SimulationDecodeError,
  TxSizeTooLargeError,
} from "./errors.js";
// Service
export {
  SafeSimulationService,
  SafeSimulationServiceLive,
  type SafeSimulationServiceShape,
} from "./service.js";
// Types
export type {
  SafeOperation,
  SafeSimulateBatchParams,
  SafeSimulationResult,
  SafeSimulationTx,
} from "./types.js";
