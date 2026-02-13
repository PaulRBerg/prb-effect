import { ContractFunctionRevertedError, BaseError as CoreError } from "viem";

export type ExecutionFailurePhase = "estimate" | "simulate";

export type DecodedExecutionFailure = {
  readonly phase: ExecutionFailurePhase;
  readonly revertReason?: string;
  readonly customErrorName?: string;
  readonly revertData?: string;
};

const REVERT_REASON_RE = /reverted with reason: (.+?)(?:\n|$)/i;
const REVERT_REASON_STRING_RE = /reverted with reason string ['"](.+?)['"]/i;
const REVERT_CUSTOM_ERROR_RE = /reverted with custom error ['"](.+?)['"]/i;
const EXECUTION_REVERTED_RE = /execution reverted(?::?\s*)(.+?)(?:\n|$)/i;
const EXECUTION_REVERTED_GENERIC_RE = /execution reverted/i;
const REVERT_DATA_RE = /(?:revert data|return data|data)\s*[:=]\s*(0x[a-fA-F0-9]+)/i;
const HEX_RE = /^0x[a-fA-F0-9]+$/;
const CUSTOM_ERROR_NAME_RE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\(.*\))?$/;

type MutableDecodedExecutionFailure = {
  hasSignal: boolean;
  revertReason?: string;
  customErrorName?: string;
  revertData?: string;
};

function normalizeReason(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCustomErrorName(value: string): string | undefined {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  const match = trimmed.match(CUSTOM_ERROR_NAME_RE);
  return match?.[1];
}

function getHexLike(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) {
    return undefined;
  }

  if (typeof value === "string") {
    return HEX_RE.test(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const hex = getHexLike(item, depth + 1);
      if (hex) {
        return hex;
      }
    }
    return undefined;
  }

  if (typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["data", "rawData", "revertData", "returnData", "hex", "value"]) {
    const hex = getHexLike(record[key], depth + 1);
    if (hex) {
      return hex;
    }
  }

  return undefined;
}

function parseExecutionText(text: string, out: MutableDecodedExecutionFailure): void {
  const normalized = text.trim();
  if (!normalized) {
    return;
  }

  const reasonString = normalized.match(REVERT_REASON_STRING_RE)?.[1];
  if (reasonString) {
    out.hasSignal = true;
    out.revertReason ??= normalizeReason(reasonString);
  }

  const reason = normalized.match(REVERT_REASON_RE)?.[1];
  if (reason) {
    out.hasSignal = true;
    out.revertReason ??= normalizeReason(reason);
  }

  const customError = normalized.match(REVERT_CUSTOM_ERROR_RE)?.[1];
  if (customError) {
    out.hasSignal = true;
    out.customErrorName ??= normalizeCustomErrorName(customError);
  }

  const revertData = normalized.match(REVERT_DATA_RE)?.[1];
  if (revertData) {
    out.hasSignal = true;
    out.revertData ??= revertData;
  }

  const executionReverted = normalized.match(EXECUTION_REVERTED_RE)?.[1];
  if (executionReverted) {
    out.hasSignal = true;
    const detail = executionReverted.trim();
    if (HEX_RE.test(detail)) {
      out.revertData ??= detail;
      out.revertReason ??= "execution reverted";
    } else {
      const custom = normalizeCustomErrorName(detail);
      if (custom) {
        out.customErrorName ??= custom;
      } else {
        out.revertReason ??= normalizeReason(detail);
      }
    }
  } else if (EXECUTION_REVERTED_GENERIC_RE.test(normalized)) {
    out.hasSignal = true;
    out.revertReason ??= "execution reverted";
  }
}

function parseRecordMessages(
  value: Record<string, unknown>,
  out: MutableDecodedExecutionFailure
): void {
  for (const key of ["message", "shortMessage", "details"]) {
    const message = value[key];
    if (typeof message === "string") {
      parseExecutionText(message, out);
    }
  }
}

function parseViemError(error: CoreError, out: MutableDecodedExecutionFailure): void {
  const reverted = error.walk(
    (candidate) => candidate instanceof ContractFunctionRevertedError
  ) as ContractFunctionRevertedError | null;

  if (reverted) {
    out.hasSignal = true;
    out.revertReason ??= normalizeReason(reverted.reason ?? "");
    out.customErrorName ??= normalizeCustomErrorName(
      (reverted.data as { errorName?: string } | undefined)?.errorName ?? ""
    );
    out.revertData ??= getHexLike(reverted.data);
    if (reverted.shortMessage) {
      parseExecutionText(reverted.shortMessage, out);
    }
  }

  parseRecordMessages(error as unknown as Record<string, unknown>, out);
  parseExecutionText(error.message, out);

  const deepest = error.walk();
  if (deepest instanceof CoreError) {
    parseRecordMessages(deepest as unknown as Record<string, unknown>, out);
    parseExecutionText(deepest.message, out);
  } else if (deepest instanceof Error) {
    parseExecutionText(deepest.message, out);
  }
}

function walkExecutionFailure(
  error: unknown,
  out: MutableDecodedExecutionFailure,
  depth = 0
): void {
  if (depth > 4 || error == null) {
    return;
  }

  if (typeof error === "string") {
    parseExecutionText(error, out);
    return;
  }

  if (error instanceof CoreError) {
    parseViemError(error, out);
  } else if (error instanceof Error) {
    parseExecutionText(error.message, out);
  }

  if (typeof error !== "object") {
    return;
  }

  const record = error as Record<string, unknown>;
  parseRecordMessages(record, out);
  out.revertData ??= getHexLike(record.data);

  walkExecutionFailure(record.cause, out, depth + 1);
  walkExecutionFailure(record.error, out, depth + 1);

  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      walkExecutionFailure(item, out, depth + 1);
    }
  }
}

export function decodeExecutionFailure(
  error: unknown,
  phase: ExecutionFailurePhase
): DecodedExecutionFailure | undefined {
  const parsed: MutableDecodedExecutionFailure = {
    hasSignal: false,
  };

  walkExecutionFailure(error, parsed);

  if (
    !parsed.hasSignal &&
    parsed.revertReason == null &&
    parsed.customErrorName == null &&
    parsed.revertData == null
  ) {
    return undefined;
  }

  return {
    customErrorName: parsed.customErrorName,
    phase,
    revertData: parsed.revertData,
    revertReason: parsed.revertReason,
  };
}

export function executionFailureReason(
  payload: DecodedExecutionFailure | undefined
): string | undefined {
  if (!payload) {
    return undefined;
  }

  return payload.revertReason ?? payload.customErrorName;
}
