import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";

import configShared from "../vitest.shared";

const CI = Boolean(process.env.CI);
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default mergeConfig(
  configShared,
  defineConfig({
    resolve: {
      alias: { "@/src": srcDir },
    },
    test: {
      include: ["src/**/*.test.ts"],
      name: "xstate",
      retry: CI ? 5 : 0,
    },
  })
);
