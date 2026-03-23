import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function getPool(databaseUrl: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  databaseUrl: string,
  text: string,
  params: unknown[] = []
) {
  const p = getPool(databaseUrl);
  return p.query<T>(text, params);
}

export async function withTransaction<T>(databaseUrl: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const p = getPool(databaseUrl);
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
