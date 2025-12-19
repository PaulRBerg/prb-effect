import { nowMillis } from "./date.js";

const DEFAULT_LOCALE: Intl.LocalesArgument = "en-US";

type DurationUnit = "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

const SECONDS_PER_UNIT: Record<DurationUnit, number> = {
  day: 86_400,
  hour: 3600,
  minute: 60,
  month: 86_400 * 30,
  second: 1,
  week: 86_400 * 7,
  year: 86_400 * 365,
};

const unitFormatterCache = new Map<string, Intl.NumberFormat>();

function unit(
  value: number,
  durationUnit: DurationUnit,
  locale: Intl.LocalesArgument = DEFAULT_LOCALE
): string {
  const key = `${String(locale)}|${durationUnit}`;
  const cached = unitFormatterCache.get(key);
  if (cached) {
    return cached.format(value);
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: durationUnit,
    unitDisplay: "long",
  });
  unitFormatterCache.set(key, formatter);
  return formatter.format(value);
}

export function durationMillis(
  milliseconds: number,
  options: {
    readonly locale?: Intl.LocalesArgument;
    readonly units?: readonly DurationUnit[];
  } = {}
): string {
  return durationSeconds(milliseconds / 1000, options);
}

export function compoundDurationSeconds(
  seconds: number,
  options: {
    readonly locale?: Intl.LocalesArgument;
  } = {}
): string {
  const { locale = DEFAULT_LOCALE } = options;
  const days = Math.floor(Math.abs(seconds) / SECONDS_PER_UNIT.day);
  const months = Math.floor(days / 30);
  const remainingDays = days % 30;

  if (months > 0 && remainingDays > 0) {
    return `${unit(months, "month", locale)} ${unit(remainingDays, "day", locale)}`;
  }
  if (months > 0) {
    return unit(months, "month", locale);
  }
  return unit(days, "day", locale);
}

export function durationSeconds(
  seconds: number,
  options: {
    readonly locale?: Intl.LocalesArgument;
    readonly units?: readonly DurationUnit[];
  } = {}
): string {
  const { locale = DEFAULT_LOCALE, units = ["year", "month", "day", "hour", "minute", "second"] } =
    options;
  const absSeconds = Math.abs(seconds);

  for (const durationUnit of units) {
    const unitSeconds = SECONDS_PER_UNIT[durationUnit];
    if (absSeconds >= unitSeconds || durationUnit === units.at(-1)) {
      const count = Math.floor(absSeconds / unitSeconds);
      return unit(count, durationUnit, locale);
    }
  }

  return unit(0, "second", locale);
}

export function elapsedMillis(
  fromMillis: number,
  now: number = nowMillis(),
  options: { readonly locale?: Intl.LocalesArgument } = {}
): string {
  const { locale = DEFAULT_LOCALE } = options;
  const diffMs = now - fromMillis;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (diffDays > 0) {
    return `${unit(diffDays, "day", locale)} ${unit(diffHours, "hour", locale)}`;
  }
  return unit(Math.max(0, diffHours), "hour", locale);
}

export type { DurationUnit };
