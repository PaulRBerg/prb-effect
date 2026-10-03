import { Option } from "effect";
import type { Hex } from "viem";
import { parseHexByte } from "#src/internal/index.js";

/**
 * Decode a bytes32 string (used by some ERC-20 tokens for name/symbol).
 * Strips trailing null bytes and decodes as UTF-8.
 * Returns undefined if the result is empty or invalid.
 */
export function decodeBytes32String(hex: Hex): string | undefined {
  if (!hex || hex === "0x" || hex.length < 4) {
    return undefined;
  }

  // Remove 0x prefix
  const bytes = hex.slice(2);

  // Convert hex to bytes, stopping at first null byte
  const chars: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) {
    const byteOption = parseHexByte(bytes.slice(i, i + 2));
    if (Option.isNone(byteOption)) {
      return undefined;
    }
    const byte = byteOption.value;
    if (byte === 0) {
      break;
    }
    chars.push(byte);
  }

  try {
    const result = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(chars)).trim();
    return result.length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}
