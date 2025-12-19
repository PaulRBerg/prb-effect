import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "./next/vitest.config.ts",
      "./web3/vitest.config.ts",
      "./fmt/vitest.config.ts",
      "./xstate/vitest.config.ts",
    ],
  },
});
