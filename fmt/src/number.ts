import { BigDecimal } from "effect";

const DEFAULT_LOCALE: Intl.LocalesArgument = "en-US";

type NumberFormatOptions = Intl.NumberFormatOptions & {
  readonly locale?: Intl.LocalesArgument;
};

const numberFormatterCache = new Map<string, Intl.NumberFormat>();

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

/**
 * Format a BigDecimal value as a number string.
 *
 * Note: BigDecimal -> number conversion can lose precision for very large values,
 * but this is acceptable for display purposes.
 */
export function bigDecimal(
  value: BigDecimal.BigDecimal,
  options: NumberFormatOptions & {
    maxFractionDigits?: number;
    minFractionDigits?: number;
  } = {}
): string {
  const numericValue = BigDecimal.unsafeToNumber(value);
  if (!Number.isFinite(numericValue)) {
    return String(value);
  }
  return numeric(numericValue, options);
}

export function decimal(value: number, options: NumberFormatOptions = {}): string {
  return getNumberFormatter(options).format(value);
}

export function integer(
  value: number,
  options: Omit<NumberFormatOptions, "maximumFractionDigits"> = {}
) {
  return getNumberFormatter({ ...options, maximumFractionDigits: 0 }).format(value);
}

/**
 * Format a number with a specified maximum number of fraction digits.
 *
 * This is a generic version that allows customization of decimal places.
 */
export function numeric(
  value: number,
  options: NumberFormatOptions & {
    maxFractionDigits?: number;
    minFractionDigits?: number;
  } = {}
): string {
  const { maxFractionDigits = 6, minFractionDigits = 0, ...rest } = options;
  return decimal(value, {
    ...rest,
    maximumFractionDigits: maxFractionDigits,
    minimumFractionDigits: minFractionDigits,
  });
}

export type { NumberFormatOptions };
