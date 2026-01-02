import { Option } from "effect";
import { DEFAULT_GAS_LIMIT_MULTIPLIER } from "@/src/constants/index.js";
import { multiplyBigintByDecimal } from "@/src/internal/index.js";

/**
 * Convert nonce to bigint regardless of input type
 */
export const nonceToBigInt = (nonce: number | bigint): bigint =>
  typeof nonce === "bigint" ? nonce : BigInt(nonce);

/**
 * Apply gas limit multiplier with safety bounds
 * Returns original gas if multiplier is invalid or would overflow
 */
export const applyGasLimitMultiplier = (gas: bigint, multiplier: number | undefined): bigint => {
  const m = multiplier ?? DEFAULT_GAS_LIMIT_MULTIPLIER;
  return Option.getOrElse(multiplyBigintByDecimal(gas, m), () => gas);
};
