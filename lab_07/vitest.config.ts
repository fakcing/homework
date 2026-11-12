import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.vitest.ts"],
    environment: "node",
    testTimeout: 15_000,
    hookTimeout: 15_000,
    passWithNoTests: false,
    coverage: {
      thresholds: { statements: 85, lines: 85, functions: 85, branches: 65 },
    },
  },
});
