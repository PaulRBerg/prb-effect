import type { Opts } from "@safe-global/safe-apps-sdk";
import { Effect } from "effect";
import { SafeAppsSdkUnavailableError } from "./errors.js";

/** Configuration for SDK initialization */
export type SafeAppsSdkConfig = Opts;

/** Load SDK dynamically to avoid SSR import issues. */
export const loadSafeSdk = (config?: SafeAppsSdkConfig) =>
  Effect.tryPromise({
    catch: (cause) =>
      new SafeAppsSdkUnavailableError({
        cause,
        message:
          "Failed to load @safe-global/safe-apps-sdk. Ensure it is installed: bun add @safe-global/safe-apps-sdk",
      }),
    try: async () => {
      const { default: SafeAppsSDK } = await import("@safe-global/safe-apps-sdk");
      return new SafeAppsSDK(config);
    },
  });

/** Type for the loaded SDK instance - uses a minimal structural type. */
export type { SafeAppsSDKInstance } from "./internal/sdk-types.js";
