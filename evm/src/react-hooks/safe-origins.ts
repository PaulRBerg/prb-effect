"use client";

/**
 * Known Safe wallet domains for iframe origin validation.
 * Includes the main Safe app and chain-specific Safe deployments.
 */
export const DEFAULT_SAFE_ORIGINS = [
  // Main Safe domains
  "https://app.safe.global",
  "https://gnosis-safe.io",
  "https://safe.global",
  // Chain-specific Safe deployments
  "https://safe.berachain.com",
  "https://safe.chiliz.com",
  "https://safe.lightlink.io",
  "https://safe.optimism.io",
] as const;

const ORIGIN_PROTOCOL_PATTERN = /^[a-z]+:\/\//i;
let safeOrigins = normalizeOrigins(DEFAULT_SAFE_ORIGINS);
let safeOriginSet = new Set(safeOrigins);
const safeOriginListeners = new Set<() => void>();
let safeOriginsConfigured = false;

/** Replace the Safe origins list (one-time configuration). */
export function setSafeOrigins(origins: readonly string[]) {
  configureSafeOrigins(normalizeOrigins(origins));
}

/** Extend the Safe origins list (one-time configuration). */
export function extendSafeOrigins(origins: readonly string[]) {
  configureSafeOrigins(normalizeOrigins([...safeOrigins, ...origins]));
}

/** Read the currently configured Safe origins list. */
export function getSafeOrigins(): readonly string[] {
  return [...safeOrigins];
}

/** Subscribe to Safe origin changes. */
export function subscribeSafeOrigins(listener: () => void): () => void {
  safeOriginListeners.add(listener);
  return () => {
    safeOriginListeners.delete(listener);
  };
}

/** Check if the parent browsing context origin is a Safe domain. */
export function isValidSafeOrigin(): boolean {
  const origin = getAncestorOrigin();
  if (!origin) {
    return false;
  }
  return safeOriginSet.has(origin);
}

/** Check whether the app is running inside an iframe. */
export function isHostEmbedded(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

/**
 * Get the origin of the parent browsing context.
 * Returns null if it cannot be determined due to cross-origin restrictions.
 */
function getAncestorOrigin(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.parent.location.origin;
  } catch {
    if (window.location.ancestorOrigins?.length) {
      return window.location.ancestorOrigins[0];
    }

    if (document.referrer) {
      try {
        return new URL(document.referrer).origin;
      } catch {
        return null;
      }
    }

    return null;
  }
}

function updateSafeOrigins(nextOrigins: string[]) {
  if (areSameOrigins(safeOrigins, nextOrigins)) {
    return;
  }

  safeOrigins = nextOrigins;
  safeOriginSet = new Set(safeOrigins);
  notifySafeOriginListeners();
}

function configureSafeOrigins(nextOrigins: string[]) {
  if (safeOriginsConfigured) {
    throw new Error("Safe origins already configured.");
  }

  safeOriginsConfigured = true;
  updateSafeOrigins(nextOrigins);
}

function notifySafeOriginListeners() {
  for (const listener of safeOriginListeners) {
    listener();
  }
}

function normalizeOrigins(origins: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const origin of origins) {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin || seen.has(normalizedOrigin)) {
      continue;
    }
    seen.add(normalizedOrigin);
    normalized.push(normalizedOrigin);
  }

  return normalized;
}

function normalizeOrigin(origin: string): string | null {
  const trimmed = origin.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = ORIGIN_PROTOCOL_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function areSameOrigins(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}
