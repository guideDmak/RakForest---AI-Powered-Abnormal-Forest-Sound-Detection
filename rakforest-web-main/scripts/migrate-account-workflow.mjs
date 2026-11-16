import pg from "pg";
import { readFile } from "node:fs/promises";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("Set DATABASE_URL before running this migration.");
const source = new URL(connectionString);
const poolerHost = process.env.ACCOUNT_DATABASE_POOLER_HOST;
if (
  poolerHost &&
  !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(poolerHost)
) {
  throw new Error("Invalid Supabase pooler host.");
}
const client = new pg.Client({
  ...(poolerHost
    ? {
        host: poolerHost,
        port: 5432,
        database: source.pathname.slice(1),
        user: `${decodeURIComponent(source.username)}.${source.hostname.split(".")[1]}`,
        password: decodeURIComponent(source.password),
      }
    : { connectionString }),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});
try {
  await client.connect();
  const before = await client.query(
    "select count(*)::int as count from public.profiles",
  );
  const flags = process.argv.slice(2);
  const mode = flags.includes("--zones")
    ? "zones"
    : flags.includes("--directory")
      ? "directory"
      : "accounts";
  const migrations = {
    zones: [
      "20261116000001_zone_soft_delete.sql",
      "forest_zones",
      "deleted_at",
    ],
    directory: [
      "20261115000002_directory_management.sql",
      "profiles",
      "deleted_at",
    ],
    accounts: [
      "20261115000001_account_requested_role.sql",
      "profiles",
      "requested_role",
    ],
  };
  const [filename, table, columnName] = migrations[mode];
  const migration = await readFile(
    new URL(`../supabase/migrations/${filename}`, import.meta.url),
    "utf8",
  );
  await client.query(migration);
  const after = await client.query(
    "select count(*)::int as count from public.profiles",
  );
  const column = await client.query(
    "select column_name from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2",
    [table, columnName],
  );
  console.log(
    JSON.stringify({
      migration: filename,
      columnReady: column.rowCount === 1,
      accountsBefore: before.rows[0].count,
      accountsAfter: after.rows[0].count,
    }),
  );
} catch (error) {
  console.error("Account migration failed:", error.code || error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
