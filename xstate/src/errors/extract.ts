import type { TxError } from "./types.js";

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

function toTxError(error: TaggedErrorShape): TxError {
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

function parseErrorMessage(message: string): TaggedErrorShape | null {
  const normalized = message.trim();
  if (!normalized.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    return hasTaggedErrorShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Extract structured error data from various error types.
 *
 * Preserves address, functionName, cause, and tag from Effect-TS tagged errors.
 */
export function extractErrorData(error: unknown, fallbackMessage = "Operation failed"): TxError {
  if (hasTaggedErrorShape(error)) {
    return toTxError(error);
  }

  if (error instanceof Error) {
    const parsedTaggedError = parseErrorMessage(error.message);
    if (parsedTaggedError) {
      return toTxError(parsedTaggedError);
    }

    return error.message;
  }

  return fallbackMessage;
}

export { hasTaggedErrorShape };
export type { TaggedErrorShape };
