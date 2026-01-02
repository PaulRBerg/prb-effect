import type { Hex } from "viem";

/**
 * Validates if a hex string is a valid signature (65 bytes)
 */
export const isValidSignature = (signature: Hex): boolean => {
  return signature.startsWith("0x") && signature.length === 132; // 0x + 130 hex chars = 65 bytes
};

/**
 * Extracts signature components without validation
 */
export const extractSignatureComponents = (signature: Hex): { r: Hex; s: Hex; v: bigint } => {
  const sig = signature.slice(2); // Remove 0x prefix
  const r = `0x${sig.slice(0, 64)}` as Hex;
  const s = `0x${sig.slice(64, 128)}` as Hex;
  const v = BigInt(`0x${sig.slice(128, 130)}`);

  return { r, s, v };
};

/**
 * Constructs signature from components
 */
export const constructSignature = (params: { r: Hex; s: Hex; v: bigint }): Hex => {
  const r = params.r.slice(2);
  const s = params.s.slice(2);
  const v = params.v.toString(16).padStart(2, "0");

  return `0x${r}${s}${v}` as Hex;
};
