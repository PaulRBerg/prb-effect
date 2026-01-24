"use client";

/**
 * Known Safe App domains for iframe origin validation.
 * Includes the main Safe App and chain-specific Safe deployments.
 */
export const DEFAULT_SAFE_APP_ORIGINS = [
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
let safeAppOrigins = normalizeOrigins(DEFAULT_SAFE_APP_ORIGINS);
let safeAppOriginSet = new Set(safeAppOrigins);
const safeAppOriginListeners = new Set<() => void>();
let safeAppOriginsConfigured = false;

/** Replace the Safe App origins list (one-time configuration). */
export function setSafeAppOrigins(origins: readonly string[]) {
  configureSafeAppOrigins(normalizeOrigins(origins));
}

/** Extend the Safe App origins list (one-time configuration). */
export function extendSafeAppOrigins(origins: readonly string[]) {
  configureSafeAppOrigins(normalizeOrigins([...safeAppOrigins, ...origins]));
}

/** Read the currently configured Safe App origins list. */
export function getSafeAppOrigins(): readonly string[] {
  return [...safeAppOrigins];
}

/** Subscribe to Safe App origin changes. */
export function subscribeSafeAppOrigins(listener: () => void): () => void {
  safeAppOriginListeners.add(listener);
  return () => {
    safeAppOriginListeners.delete(listener);
  };
}

/** Check if the parent browsing context origin is a Safe App domain. */
export function isValidSafeAppOrigin(): boolean {
  const origin = getAncestorOrigin();
  if (!origin) {
    return false;
  }
  return safeAppOriginSet.has(origin);
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

function updateSafeAppOrigins(nextOrigins: string[]) {
  if (areSameOrigins(safeAppOrigins, nextOrigins)) {
    return;
  }

  safeAppOrigins = nextOrigins;
  safeAppOriginSet = new Set(safeAppOrigins);
  notifySafeAppOriginListeners();
}

function configureSafeAppOrigins(nextOrigins: string[]) {
  if (safeAppOriginsConfigured) {
    throw new Error("Safe App origins already configured.");
  }

  safeAppOriginsConfigured = true;
  updateSafeAppOrigins(nextOrigins);
}

function notifySafeAppOriginListeners() {
  for (const listener of safeAppOriginListeners) {
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
