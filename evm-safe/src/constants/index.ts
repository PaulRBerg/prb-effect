import { Duration } from "effect";

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
