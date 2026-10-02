// Integration tests against a real Postgres (the isolated tara_mini_test DB).
//   pnpm test:db
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://tara:tara@localhost:5433/tara_mini_test?schema=public";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    globalSetup: ["./test/db/globalSetup.ts"],
    env: { DATABASE_URL: TEST_DATABASE_URL },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
