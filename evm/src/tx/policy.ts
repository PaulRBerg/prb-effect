/** Transaction execution policy */
import {
  DEFAULT_GAS_LIMIT_MULTIPLIER,
  DEFAULT_POLLING_INTERVAL,
  DEFAULT_RECEIPT_TIMEOUT,
} from "@/src/constants/index.js";
import type { GasSpeed } from "@/src/gas/index.js";

export type TxPolicy = {
  /** Max fee per gas in wei (optional cap) */
  maxFeePerGas?: bigint;
  /** Max priority fee per gas in wei */
  maxPriorityFeePerGas?: bigint;
  /** Fee estimation speed tier */
  feeSpeed?: GasSpeed;
  /** Gas limit multiplier applied to estimates */
  gasLimitMultiplier?: number;
  /** Timeout in milliseconds for receipt polling */
  receiptTimeout?: number;
  /** Polling interval in milliseconds */
  pollingInterval?: number;
  /** Replacement strategy when stuck */
  replacementStrategy?: "speedup" | "cancel" | "none";
  /** Replacement behavior (preferred) */
  replacement?: {
    strategy?: "speedup" | "cancel" | "none";
    /** Consider tx stuck after N milliseconds */
    stuckMs?: number;
    /** Maximum automatic replacement attempts */
    maxAttempts?: number;
  };
};

export const defaultPolicy: TxPolicy = {
  feeSpeed: "standard",
  gasLimitMultiplier: DEFAULT_GAS_LIMIT_MULTIPLIER,
  pollingInterval: DEFAULT_POLLING_INTERVAL,
  receiptTimeout: DEFAULT_RECEIPT_TIMEOUT,
  replacementStrategy: "none",
};
