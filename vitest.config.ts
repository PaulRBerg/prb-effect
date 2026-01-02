import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "./next/vitest.config.ts",
      "./evm/vitest.config.ts",
      "./solana/vitest.config.ts",
      "./xstate/vitest.config.ts",
    ],
  },
});
