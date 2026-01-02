/**
 * Shared constants used across the codebase.
 */

import { Duration } from "effect";

// =============================================================================
// Gas Constants
// =============================================================================

/** Default multiplier for estimated gas limits (10% safety margin). */
export const DEFAULT_GAS_LIMIT_MULTIPLIER = 1.1;

/**
 * Minimum gas required for a basic Ethereum transaction (21,000 gas units).
 * @see https://ethereum.stackexchange.com/q/34674/24693
 */
export const MIN_TX_GAS = 21000n;

// =============================================================================
// Timing Constants (milliseconds)
// =============================================================================

/** Default maximum delay for circuit breakers and subscriptions. */
export const DEFAULT_MAX_DELAY = Duration.toMillis("30 seconds");

/** Default timeout for waiting on a transaction receipt. */
export const DEFAULT_RECEIPT_TIMEOUT = Duration.toMillis("2 minutes");

/** Default timeout for RPC requests. */
export const DEFAULT_REQUEST_TIMEOUT = Duration.toMillis("10 seconds");

/** Default time before a transaction is considered stuck. */
export const DEFAULT_STUCK_TX_MS = Duration.toMillis("45 seconds");

/** Default timeout for waiting on a specific block. */
export const DEFAULT_BLOCK_WAIT_TIMEOUT = Duration.toMillis("60 seconds");

/** Default polling interval for transaction receipt and confirmation checks. */
export const DEFAULT_POLLING_INTERVAL = Duration.toMillis("4 seconds");

/** Default delay between RPC retries. */
export const DEFAULT_RETRY_DELAY = Duration.toMillis("150 millis");

/** Default base delay for subscription exponential backoff. */
export const DEFAULT_SUBSCRIPTION_BASE_DELAY = Duration.toMillis("500 millis");

/** Default debounce delay for cursor store flush operations. */
export const DEFAULT_CURSOR_FLUSH_DELAY = "250 millis";

// =============================================================================
// Safe Apps Constants
// =============================================================================

/** Default poll interval for Safe gateway status checks. */
export const SAFE_POLL_INTERVAL = Duration.toMillis("3 seconds");

/** Default timeout for Safe transaction execution. */
export const SAFE_EXECUTION_TIMEOUT = Duration.toMillis("5 minutes");

/** Default poll interval for off-chain signature checks. */
export const SAFE_SIGNATURE_POLL_INTERVAL = Duration.toMillis("2 seconds");

/** Default timeout for off-chain signature availability. */
export const SAFE_SIGNATURE_TIMEOUT = Duration.toMillis("2 minutes");
