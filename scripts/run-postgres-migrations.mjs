import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(rootDir, 'db', 'migrations');

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  return process.env.DATABASE_URL;
}

function isLocalDatabaseUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function shouldUseSsl(databaseUrl) {
  if (process.env.POSTGRES_SSL === 'true') return true;
  if (process.env.POSTGRES_SSL === 'false') return false;
  return !isLocalDatabaseUrl(databaseUrl);
}

async function main() {
  const databaseUrl = requireDatabaseUrl();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: shouldUseSsl(databaseUrl)
      ? {
          rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'false',
        }
      : undefined,
  });

  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const alreadyApplied = await client.query(
        'select 1 from schema_migrations where filename = $1 limit 1',
        [file]
      );

      if (alreadyApplied.rows[0]) {
        console.log(`Skipping ${file}`);
        continue;
      }

      const migrationSql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      console.log(`Applying ${file}`);
      await client.query('begin');
      try {
        await client.query(migrationSql);
        await client.query(
          'insert into schema_migrations (filename) values ($1)',
          [file]
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }

    console.log('Postgres migrations are up to date.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
