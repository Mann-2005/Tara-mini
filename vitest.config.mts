import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.db.test.ts"], // run with `pnpm test:db`
    coverage: {
      provider: "v8",
      // V2 rule: financial and scoring algorithms are pure and fully covered.
      include: ["src/domain/analytics/**/*.ts", "src/domain/money.ts"],
      exclude: ["src/domain/analytics/**/*.test.ts", "src/domain/analytics/types.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
    },
  },
});
