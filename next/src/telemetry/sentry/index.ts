import "server-only";

import type { TelemetryAdapter } from "../index.js";
import { createTelemetryLayer } from "../index.js";

/**
 * @category models
 */
export type SentryAdapter = TelemetryAdapter;

/**
 * Creates a telemetry layer backed by a Sentry-like adapter.
 *
 * @category layers
 */
export const createSentryTelemetryLayer = createTelemetryLayer;

/**
 * @category models
 */
export type SentryInstrumentationOptions = {
  readonly init: (config: unknown) => void;
  readonly captureRequestError: (error: unknown) => void;
  readonly createConfig: () => unknown | Promise<unknown>;
  readonly enabled?: boolean | (() => boolean);
  readonly shouldInit?: () => boolean;
};

const resolveEnabled = (value: boolean | (() => boolean) | undefined): boolean =>
  typeof value === "function" ? value() : (value ?? true);

/**
 * Creates Next.js instrumentation helpers for Sentry without hard-coded defaults.
 *
 * @category utils
 */
export const createSentryInstrumentation = (options: SentryInstrumentationOptions) => {
  const shouldInit =
    options.shouldInit ??
    (() => typeof process !== "undefined" && process.env.NEXT_RUNTIME === "nodejs");
  const isEnabled = () => resolveEnabled(options.enabled) && shouldInit();

  const register = async () => {
    if (!isEnabled()) {
      return;
    }
    const config = await options.createConfig();
    options.init(config);
  };

  return {
    onRequestError: (error: unknown) => {
      if (!isEnabled()) {
        return;
      }
      options.captureRequestError(error);
    },
    register,
  };
};
