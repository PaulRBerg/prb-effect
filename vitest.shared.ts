/**
 * Shared Vitest project configuration for this monorepo.
 *
 * Keep only project-scoped options here (environment, reporters, timeouts, etc.)
 * so it can be merged into multiple Vitest projects.
 */
import { defineConfig } from "vitest/config";

const CI = Boolean(process.env.CI);

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    hideSkippedTests: true,
    outputFile: CI ? "./test-results.json" : undefined,
    reporters: CI ? ["github-actions", "json"] : ["dot"],
    testTimeout: CI ? 120_000 : 60_000,
  },
});
