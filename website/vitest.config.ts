import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "test-results/coverage",
      thresholds: { lines: 75, statements: 75, functions: 65, branches: 65 },
    },
  },
});
