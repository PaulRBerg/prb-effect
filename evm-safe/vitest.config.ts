import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";

import configShared from "../vitest.shared.js";

const CI = Boolean(process.env.CI);
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const evmPackageDir = fileURLToPath(new URL("../evm/", import.meta.url));
const evmDistDir = fileURLToPath(new URL("../evm/dist", import.meta.url));

export default mergeConfig(
  configShared,
  defineConfig({
    resolve: {
      alias: [
        {
          find: /^#src\/(.+)$/,
          replacement: "$1",
          // `#src/*` self-imports appear both in evm-safe's own sources (→ ./src)
          // and inside the built @prb/effect-evm dist (→ ../evm/dist). Vite does
          // not honor a linked package's `imports` field and plain aliases are
          // importer-blind, so route by the importing file.
          customResolver(source, importer, options) {
            const base = importer?.startsWith(evmPackageDir) ? evmDistDir : srcDir;
            return this.resolve(path.join(base, source), importer, {
              ...options,
              skipSelf: true,
            });
          },
        },
      ],
    },
    test: {
      include: ["evm-safe/src/**/*.test.ts", "evm-safe/src/**/*.test.integration.ts"],
      name: "evm-safe",
      retry: CI ? 3 : 0,
      root: rootDir,
    },
  })
);
