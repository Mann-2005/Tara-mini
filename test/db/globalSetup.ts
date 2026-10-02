// Prepares the isolated test database before the DB test run:
// drops and recreates its schema, then applies all migrations (including the
// GoBD triggers), so tests run against exactly the production schema.
// Refuses to touch any database whose name does not end in "_test".

import { execSync } from "node:child_process";
import { Client } from "pg";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://tara:tara@localhost:5433/tara_mini_test?schema=public";

export default async function setup() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to reset "${dbName}": test database names must end in _test`);

  const client = new Client({ connectionString: TEST_DATABASE_URL.split("?")[0] });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();

  execSync("pnpm prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
