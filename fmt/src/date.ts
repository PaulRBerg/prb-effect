import { DateTime, Option } from "effect";

const DEFAULT_LOCALE: Intl.LocalesArgument = "en-US";
const INVALID_DATE_LABEL = "Invalid date";

type RelativeUnit = Exclude<Intl.RelativeTimeFormatUnit, "quarter">;
type DateZone = "local" | "utc";

type DateTimeLabelOptions = {
  readonly includeSeconds?: boolean;
  readonly includeMinutes?: boolean;
  readonly includeTime?: boolean;
  readonly dateTimeSeparator?: string;
  readonly locale?: Intl.LocalesArgument;
  readonly padDay?: boolean;
  readonly zone?: DateZone;
  readonly withAt?: boolean;
};

const relativeDivisions: readonly { amount: number; unit: RelativeUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.345_24, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFormatter(
  options: Intl.DateTimeFormatOptions & {
    readonly locale?: Intl.LocalesArgument;
  } = {}
): Intl.DateTimeFormat {
  const { locale = DEFAULT_LOCALE, ...intlOptions } = options;
  const key = JSON.stringify([locale, intlOptions]);
  const cached = dateTimeFormatterCache.get(key);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locale, intlOptions);
  dateTimeFormatterCache.set(key, formatter);
  return formatter;
}

function resolveTimeZone(zone: DateZone): "UTC" | undefined {
  if (zone === "utc") {
    return "UTC";
  }
  return undefined;
}

function resolveDateTimeSeparator(dateTimeSeparator: string | undefined, withAt: boolean): string {
  if (dateTimeSeparator !== undefined) {
    return dateTimeSeparator;
  }
  return withAt ? " @ " : " ";
}

function buildDateLabelFromParts(parts: Intl.DateTimeFormatPart[]): string {
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  return `${month} ${day} '${year}`.trim();
}

function buildTimeLabelFromParts(
  parts: Intl.DateTimeFormatPart[],
  options: {
    readonly includeMinutes: boolean;
    readonly includeSeconds: boolean;
  }
): string {
  const { includeMinutes, includeSeconds } = options;

  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = includeMinutes
    ? (parts.find((part) => part.type === "minute")?.value ?? "")
    : undefined;
  const second = includeSeconds
    ? (parts.find((part) => part.type === "second")?.value ?? "")
    : undefined;
  const dayPeriod = (parts.find((part) => part.type === "dayPeriod")?.value ?? "").toLowerCase();

  const time = [hour, minute, second].filter((value) => value !== undefined).join(":");
  return `${time} ${dayPeriod}`.trim();
}

function buildDateTimeLabelFromDate(date: Date, options: DateTimeLabelOptions = {}): string {
  const {
    includeSeconds = false,
    includeMinutes = true,
    includeTime = true,
    dateTimeSeparator,
    locale = DEFAULT_LOCALE,
    padDay = false,
    zone = "local",
    withAt = true,
  } = options;

  const timeZone = resolveTimeZone(zone);

  const dateLabel = buildDateLabelFromParts(
    getDateTimeFormatter({
      day: padDay ? "2-digit" : "numeric",
      locale,
      month: "short",
      timeZone,
      year: "2-digit",
    }).formatToParts(date)
  );

  if (!includeTime) {
    return dateLabel;
  }

  const timeLabel = buildTimeLabelFromParts(
    getDateTimeFormatter({
      hour: "numeric",
      hour12: true,
      locale,
      minute: includeMinutes ? "2-digit" : undefined,
      second: includeSeconds ? "2-digit" : undefined,
      timeZone,
    }).formatToParts(date),
    { includeMinutes, includeSeconds }
  );

  const separator = resolveDateTimeSeparator(dateTimeSeparator, withAt);
  return `${dateLabel}${separator}${timeLabel}`.trim();
}

const withDateTime = (
  timestampMillis: number,
  onSome: (args: { date: Date; dateTime: DateTime.DateTime }) => string
): string =>
  Option.match(DateTime.make(timestampMillis), {
    onNone: () => INVALID_DATE_LABEL,
    onSome: (dateTime) => onSome({ date: DateTime.toDate(dateTime), dateTime }),
  });

export function dateMillis(
  timestampMillis: number,
  options: Omit<DateTimeLabelOptions, "includeTime"> = {}
): string {
  return dateTimeMillis(timestampMillis, { ...options, includeTime: false });
}

export function dateSeconds(
  timestampSeconds: number,
  options: Omit<DateTimeLabelOptions, "includeTime"> = {}
): string {
  return dateTimeSeconds(timestampSeconds, { ...options, includeTime: false });
}

export function dateTimeMillis(
  timestampMillis: number,
  options: DateTimeLabelOptions = {}
): string {
  return withDateTime(timestampMillis, ({ date }) => buildDateTimeLabelFromDate(date, options));
}

export function dateTimeSeconds(
  timestampSeconds: number,
  options: DateTimeLabelOptions = {}
): string {
  return dateTimeMillis(timestampSeconds * 1000, options);
}

export function monthYearMillis(
  timestampMillis: number,
  options: {
    readonly locale?: Intl.LocalesArgument;
    readonly zone?: DateZone;
  } = {}
): string {
  const { locale = DEFAULT_LOCALE, zone = "local" } = options;
  const timeZone = zone === "utc" ? "UTC" : undefined;

  return withDateTime(timestampMillis, ({ date }) =>
    getDateTimeFormatter({
      locale,
      month: "short",
      timeZone,
      year: "2-digit",
    }).format(date)
  );
}

/**
 * Current time in milliseconds.
 *
 * Use this instead of raw `Date.now()` for consistency and testability.
 */
export function nowMillis(): number {
  return Date.now();
}

/**
 * Current time in Unix seconds (truncated integer).
 *
 * Use this instead of `Math.floor(Date.now() / 1000)` for integer timestamps.
 * Uses `Math.trunc` to match BigInt division semantics (truncate toward zero).
 */
export function nowSeconds(): number {
  return Math.trunc(Date.now() / 1000);
}

/**
 * Format relative time from a timestamp to now.
 *
 * @example
 * relativeTime(Date.now() - 60000) // "1 minute ago"
 */
export function relativeTime(
  timestampMillis: number,
  locale: Intl.LocalesArgument = DEFAULT_LOCALE
): string {
  const relativeFormatter = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
  });

  return withDateTime(timestampMillis, ({ dateTime }) => {
    const now = DateTime.unsafeNow();
    const diffSeconds = DateTime.distance(now, dateTime) / 1000;

    let duration = diffSeconds;
    const sign = Math.sign(duration);

    for (const division of relativeDivisions) {
      if (Math.abs(duration) < division.amount) {
        const rounded = sign * Math.round(Math.abs(duration));
        return relativeFormatter.format(rounded, division.unit);
      }
      duration /= division.amount;
    }

    return relativeFormatter.format(0, "second");
  });
}

export function utcOffset(date: Date = new Date()): string {
  const totalMinutes = -date.getTimezoneOffset();
  const sign = totalMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(totalMinutes);
  const hours = Math.floor(abs / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (abs % 60).toString().padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

export function utcOffsetLabel(date: Date = new Date()): string {
  return `UTC${utcOffset(date)}`;
}

export type { DateTimeLabelOptions, DateZone };
