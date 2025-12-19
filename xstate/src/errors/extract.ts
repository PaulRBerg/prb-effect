import type { TransactionError } from "./types.js";

/**
 * Shape of a tagged error with common fields
 */
type TaggedErrorShape = {
  _tag: string;
  message: string;
  address?: string;
  calldata?: string;
  functionName?: string;
  sender?: string;
  cause?: unknown;
};

/**
 * Type guard to check if an error has the tagged error shape.
 */
function hasTaggedErrorShape(error: unknown): error is TaggedErrorShape {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof (error as TaggedErrorShape)._tag === "string" &&
    "message" in error &&
    typeof (error as TaggedErrorShape).message === "string"
  );
}

/**
 * Extract structured error data from various error types.
 *
 * Preserves address, functionName, cause, and tag from Effect-TS tagged errors.
 */
export function extractErrorData(
  error: unknown,
  fallbackMessage = "Operation failed"
): TransactionError {
  if (hasTaggedErrorShape(error)) {
    return {
      details: {
        address: error.address,
        calldata: error.calldata,
        cause: error.cause,
        functionName: error.functionName,
        sender: error.sender,
        tag: error._tag,
      },
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallbackMessage;
}

export { hasTaggedErrorShape };
export type { TaggedErrorShape };
