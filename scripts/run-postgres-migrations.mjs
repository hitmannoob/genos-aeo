import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(rootDir, 'db', 'migrations');

dotenv.config({
  path: [path.join(rootDir, '.env.local'), path.join(rootDir, '.env')],
  quiet: true,
});

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

  let client;
  let migrationLockAcquired = false;
  try {
    client = await pool.connect();
    await client.query("select pg_advisory_lock(hashtext('genos_schema_migrations'))");
    migrationLockAcquired = true;
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        checksum text,
        applied_at timestamptz not null default now()
      )
    `);
    await client.query('alter table schema_migrations add column if not exists checksum text');

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const migrationSql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = createHash('sha256').update(migrationSql).digest('hex');
      const alreadyApplied = await client.query(
        'select checksum from schema_migrations where filename = $1 limit 1',
        [file]
      );

      if (alreadyApplied.rows[0]) {
        const storedChecksum = alreadyApplied.rows[0].checksum;
        if (storedChecksum && storedChecksum !== checksum) {
          throw new Error(`Migration checksum mismatch for ${file}`);
        }
        if (!storedChecksum) {
          await client.query(
            'update schema_migrations set checksum = $2 where filename = $1',
            [file, checksum]
          );
        }
        console.log(`Skipping ${file}`);
        continue;
      }

      console.log(`Applying ${file}`);
      await client.query('begin');
      try {
        await client.query(migrationSql);
        await client.query(
          'insert into schema_migrations (filename, checksum) values ($1, $2)',
          [file, checksum]
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }

    console.log('Postgres migrations are up to date.');
  } finally {
    if (client) {
      if (migrationLockAcquired) {
        try {
          await client.query("select pg_advisory_unlock(hashtext('genos_schema_migrations'))");
        } catch {
          // The session disappearing also releases its advisory locks.
        }
      }
      client.release();
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
