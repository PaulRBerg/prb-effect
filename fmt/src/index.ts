/** biome-ignore-all lint/performance/noNamespaceImport: we're OK with this here */
import * as date from "./date.js";
import * as duration from "./duration.js";
import * as number from "./number.js";

export const fmt = {
  date,
  duration,
  number,
} as const;

export type Fmt = typeof fmt;

// Also export individual modules for direct imports
export * as fmtDate from "./date.js";
export * as fmtDuration from "./duration.js";
export * as fmtNumber from "./number.js";
