import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";

import configShared from "../vitest.shared.js";

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
      name: "solana",
      retry: CI ? 3 : 0,
    },
  })
);
