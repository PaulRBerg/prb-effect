/** Structured error details for display in UI */
export type ErrorDetails = {
  /** Contract address (if applicable) */
  address?: string;
  /** Encoded calldata for the failed transaction */
  calldata?: string;
  /** Raw cause/details from viem or other sources */
  cause?: unknown;
  /** Function name that failed */
  functionName?: string;
  /** Sender address (wallet that initiated the transaction) */
  sender?: string;
  /** Transaction msg.value as a decimal string */
  value?: string;
  /** Error tag/type identifier */
  tag?: string;
};

/** Error state supporting both simple strings and structured data */
export type TxError =
  | string
  | {
      details?: ErrorDetails;
      message: string;
    };
