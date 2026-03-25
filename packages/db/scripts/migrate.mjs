import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.DATABASE_URL;
const migrationsDir = process.env.MIGRATIONS_DIR ?? path.resolve(__dirname, "../../../db/migrations");

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

async function waitForDatabase(url) {
  const maxAttempts = 30;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function ensureSchemaMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getPendingMigrationFiles(client) {
  const entries = await readdir(migrationsDir);
  const migrationFiles = entries
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  const pending = [];

  for (const filename of migrationFiles) {
    const version = filename.replace(/\.sql$/, "");
    const existing = await client.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1 LIMIT 1",
      [version]
    );

    if (existing.rowCount === 0) {
      pending.push({ filename, version });
    }
  }

  return pending;
}

async function applyMigration(client, filename, version) {
  const fullPath = path.join(migrationsDir, filename);
  const sql = await readFile(fullPath, "utf8");

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
      [version]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  console.log(`Waiting for database: ${databaseUrl}`);
  await waitForDatabase(databaseUrl);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureSchemaMigrationsTable(client);
    const pending = await getPendingMigrationFiles(client);

    let applied = 0;
    let skipped = 0;

    const allEntries = (await readdir(migrationsDir))
      .filter((entry) => entry.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const filename of allEntries) {
      const version = filename.replace(/\.sql$/, "");
      const isPending = pending.find((entry) => entry.version === version);

      if (!isPending) {
        console.log(`Skipped (already applied): ${version}`);
        skipped += 1;
        continue;
      }

      console.log(`Applying: ${version}`);
      await applyMigration(client, filename, version);
      console.log(`Applied: ${version}`);
      applied += 1;
    }

    console.log(`Migrations complete: ${applied} applied, ${skipped} skipped.`);
  } finally {
    await client.end();
  }
}

await main();
