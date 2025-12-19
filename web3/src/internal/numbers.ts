import { BigDecimal, Option } from "effect";

const DEFAULT_LOCALE: Intl.LocalesArgument = "en-US";
const WEI_DECIMALS = 18;

export type NumberFormatOptions = Intl.NumberFormatOptions & {
  readonly locale?: Intl.LocalesArgument;
};

// ============================================================================
// Formatter Caching
// ============================================================================

const numberFormatterCache = new Map<string, Intl.NumberFormat>();

// Regex patterns
const HEX_PATTERN = /^[0-9a-f]+$/;
const HEX_BYTE_PATTERN = /^[0-9a-fA-F]{2}$/;

function getNumberFormatter(options: NumberFormatOptions = {}): Intl.NumberFormat {
  const { locale = DEFAULT_LOCALE, ...intlOptions } = options;
  const key = JSON.stringify([locale, intlOptions]);
  const cached = numberFormatterCache.get(key);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat(locale, intlOptions);
  numberFormatterCache.set(key, formatter);
  return formatter;
}

// ============================================================================
// Constants
// ============================================================================

export { DEFAULT_LOCALE, WEI_DECIMALS };

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse a string into a BigDecimal.
 * Returns None if the string is not a valid number.
 */
export function fromString(input: string): Option.Option<BigDecimal.BigDecimal> {
  return BigDecimal.fromString(input);
}

/**
 * Convert a number to BigDecimal.
 * Returns None if the number is not finite (NaN, Infinity, -Infinity).
 */
export function fromNumber(input: number): Option.Option<BigDecimal.BigDecimal> {
  if (!Number.isFinite(input)) {
    return Option.none();
  }
  return Option.some(BigDecimal.fromNumber(input));
}

/**
 * Convert a bigint to BigDecimal.
 */
export function fromBigint(input: bigint): BigDecimal.BigDecimal {
  return BigDecimal.fromBigInt(input);
}

/**
 * Parse a hex string (with or without 0x prefix) to a number.
 * Returns None if the string is not valid hex or the result exceeds Number.MAX_SAFE_INTEGER.
 */
export function parseHexInt(hex: string): Option.Option<number> {
  const stripped = hex.toLowerCase().startsWith("0x") ? hex.slice(2) : hex;
  if (!HEX_PATTERN.test(stripped)) {
    return Option.none();
  }
  const value = Number.parseInt(stripped, 16);
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) {
    return Option.none();
  }
  return Option.some(value);
}

/**
 * Parse exactly 2 hex characters into a number (0-255).
 * Returns None if input is not exactly 2 valid hex characters.
 */
export function parseHexByte(hexByte: string): Option.Option<number> {
  if (hexByte.length !== 2) {
    return Option.none();
  }
  if (!HEX_BYTE_PATTERN.test(hexByte)) {
    return Option.none();
  }
  const value = Number.parseInt(hexByte, 16);
  return Option.some(value);
}

// ============================================================================
// Arithmetic Helpers
// ============================================================================

/**
 * Calculate a percentage of a BigDecimal value.
 * Result = value * (percent / 100)
 */
export function percentageBD(
  value: BigDecimal.BigDecimal,
  percent: BigDecimal.BigDecimal
): BigDecimal.BigDecimal {
  const hundred = BigDecimal.unsafeFromString("100");
  // divide returns Option, but we know 100 is not zero, so we can use unsafeDivide
  const fraction = BigDecimal.unsafeDivide(percent, hundred);
  return BigDecimal.multiply(value, fraction);
}

/**
 * Calculate a percentage of a bigint using basis points.
 * Returns (value * basisPoints) / 10000n
 */
export function percentOfBigint(value: bigint, basisPoints: bigint): bigint {
  return (value * basisPoints) / 10000n;
}

/**
 * Bump a bigint value by a percentage (in basis points) with ceiling rounding.
 * Returns (value * (10000 + basisPoints) + 9999) / 10000
 * Replaces patterns like bump12_5.
 */
export function bumpByPercent(value: bigint, basisPoints: bigint): bigint {
  return (value * (10000n + basisPoints) + 9999n) / 10000n;
}

/**
 * Multiply a bigint by a decimal multiplier (for gas limit scaling, etc.).
 * Returns None if multiplier is invalid (not finite, negative) or result would overflow.
 */
export function multiplyBigintByDecimal(value: bigint, multiplier: number): Option.Option<bigint> {
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    return Option.none();
  }

  try {
    // Convert multiplier to basis points to avoid floating point
    const basisPoints = Math.floor(multiplier * 10_000);
    const result = (value * BigInt(basisPoints)) / 10000n;
    return Option.some(result);
  } catch {
    return Option.none();
  }
}

/**
 * Safely divide two BigDecimal values.
 * Returns None if denominator is zero.
 */
export function safeDivide(
  numerator: BigDecimal.BigDecimal,
  denominator: BigDecimal.BigDecimal
): Option.Option<BigDecimal.BigDecimal> {
  return BigDecimal.divide(numerator, denominator);
}

/**
 * Ceiling division for bigints.
 * Returns ceil(numerator / denominator)
 */
export function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Scale a BigDecimal by a power of 10.
 * Direction "up" multiplies by 10^decimals (e.g., human-readable to wei).
 * Direction "down" divides by 10^decimals (e.g., wei to human-readable).
 */
export function scaleByDecimals(
  value: BigDecimal.BigDecimal,
  decimals: number,
  direction: "up" | "down"
): BigDecimal.BigDecimal {
  if (decimals === 0) {
    return value;
  }

  const scale = BigDecimal.unsafeFromString(String(10 ** Math.abs(decimals)));

  if (direction === "up") {
    return decimals > 0 ? BigDecimal.multiply(value, scale) : BigDecimal.unsafeDivide(value, scale);
  }
  return decimals > 0 ? BigDecimal.unsafeDivide(value, scale) : BigDecimal.multiply(value, scale);
}

/**
 * Convert wei (bigint) to a human-readable BigDecimal with 18 decimals.
 */
export function fromWei(wei: bigint): BigDecimal.BigDecimal {
  return BigDecimal.make(wei, WEI_DECIMALS);
}

/**
 * Convert a BigDecimal to wei (bigint).
 * Returns None if the value has fractional wei (scale < 18).
 */
export function toWei(value: BigDecimal.BigDecimal): Option.Option<bigint> {
  const scaled = BigDecimal.scale(value, WEI_DECIMALS);

  // Normalize to check if there's a fractional component
  const normalized = BigDecimal.normalize(scaled);

  // If scale is negative after normalization, there are fractional parts
  if (normalized.scale < 0) {
    return Option.none();
  }

  try {
    const result = normalized.value;
    return Option.some(result);
  } catch {
    return Option.none();
  }
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format a number as an integer (no decimal places).
 */
export function integer(
  value: number,
  options: Omit<NumberFormatOptions, "maximumFractionDigits"> = {}
): string {
  return getNumberFormatter({ ...options, maximumFractionDigits: 0 }).format(value);
}

/**
 * Format a number with decimal places.
 */
export function decimal(value: number, options: NumberFormatOptions = {}): string {
  return getNumberFormatter(options).format(value);
}

/**
 * Format a token amount with up to 6 decimal places.
 */
export function tokenAmount(
  value: number,
  options: Omit<NumberFormatOptions, "maximumFractionDigits" | "minimumFractionDigits"> = {}
): string {
  return decimal(value, {
    ...options,
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
  });
}

/**
 * Format a BigDecimal token amount with up to 6 decimal places.
 * Falls back to string representation if conversion to number fails.
 */
export function tokenAmountBD(
  value: BigDecimal.BigDecimal,
  options: Omit<NumberFormatOptions, "maximumFractionDigits" | "minimumFractionDigits"> = {}
): string {
  const numericValue = BigDecimal.unsafeToNumber(value);
  if (!Number.isFinite(numericValue)) {
    return String(value);
  }
  return tokenAmount(numericValue, options);
}

/**
 * Format a gas amount (bigint) as a readable integer.
 */
export function formatGas(gas: bigint): string {
  const numericValue = Number(gas);
  if (!Number.isFinite(numericValue)) {
    return gas.toString();
  }
  return integer(numericValue);
}

/**
 * Format a number as a percentage.
 */
export function formatPercent(
  value: number,
  options: Omit<NumberFormatOptions, "style"> = {}
): string {
  return getNumberFormatter({ ...options, style: "percent" }).format(value);
}
