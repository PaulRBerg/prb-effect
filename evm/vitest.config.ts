import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";

import configShared from "../vitest.shared.js";

const CI = Boolean(process.env.CI);
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default mergeConfig(
  configShared,
  defineConfig({
    resolve: {
      alias: { "#src": srcDir },
    },
    test: {
      include: ["evm/src/**/*.test.ts", "evm/src/**/*.test.integration.ts"],
      name: "evm",
      retry: CI ? 3 : 0,
      root: rootDir,
    },
  })
);
