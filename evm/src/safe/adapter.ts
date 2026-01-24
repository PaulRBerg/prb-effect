import { Effect } from "effect";
import { SafeAppsSdkUnavailableError } from "./errors.js";

/** Configuration for SDK initialization */
export type SafeAppsSdkConfig = {
  allowedDomains?: RegExp[];
  debug?: boolean;
};

/** Load SDK dynamically - keeps the dependency optional at runtime */
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

/** Type for the loaded SDK instance - uses any due to optional SDK dependency */
// biome-ignore lint/suspicious/noExplicitAny: SDK is optional dependency
export type SafeAppsSDKInstance = any;
