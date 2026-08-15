import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({
  path: [path.join(rootDir, '.env.local'), path.join(rootDir, '.env')],
  quiet: true,
});

if (process.env.ALLOW_DATABASE_INTEGRATION_TESTS !== 'true') {
  throw new Error('Set ALLOW_DATABASE_INTEGRATION_TESTS=true to run SQLite runtime checks');
}

const { sql, withTransaction } = await import('../src/lib/db/sqlite-core.ts');
const suffix = `${process.pid}-${Date.now()}`;
const firebaseUid = `runtime-user-${suffix}`;

const user = await sql(
  `
    insert into app_users (
      firebase_uid, email, display_name, is_new_user, last_login_at
    ) values ($1, $2, $3, true, now())
    returning id, firebase_uid, credit_balance, is_new_user, last_login_at
  `,
  [firebaseUid, `runtime-${suffix}@example.test`, 'Runtime verification']
);

assert.equal(user.rowCount, 1);
assert.equal(user.rows[0].firebase_uid, firebaseUid);
assert.equal(user.rows[0].is_new_user, true);
assert.match(String(user.rows[0].last_login_at), /^\d{4}-\d{2}-\d{2}T/);
const userId = user.rows[0].id;

const brandId = await withTransaction(async (client) => {
  const brand = await client.query(
    `
      insert into brands (
        user_id, domain, company_name, products_and_services,
        keywords, setup_complete, raw_metadata
      ) values ($1, $2, $3, $4, $5, true, $6::jsonb)
      returning id
    `,
    [
      userId,
      `runtime-${suffix}.example`,
      'Runtime Brand',
      ['Product A'],
      ['Topic A'],
      { source: 'runtime-verification' },
    ]
  );
  const createdBrandId = brand.rows[0].id;

  await client.query(
    `
      insert into brand_queries (
        brand_id, query, keyword, category, selected
      ) values ($1, $2, $3, $4, true)
      returning id
    `,
    [createdBrandId, 'Which runtime query verifies SQLite?', 'runtime', 'Awareness']
  );

  const locked = await client.query(
    `
      select id, products_and_services, keywords, setup_complete, raw_metadata
      from brands
      where user_id = $1 and id::text = $2
      for update
    `,
    [userId, createdBrandId]
  );
  assert.deepEqual(locked.rows[0].products_and_services, ['Product A']);
  assert.deepEqual(locked.rows[0].keywords, ['Topic A']);
  assert.equal(locked.rows[0].setup_complete, true);
  assert.deepEqual(locked.rows[0].raw_metadata, { source: 'runtime-verification' });

  return createdBrandId;
});

await Promise.all(
  Array.from({ length: 20 }, () => withTransaction(async (client) => {
    const balance = await client.query(
      'select credit_balance from app_users where id = $1 for update',
      [userId]
    );
    await client.query(
      'update app_users set credit_balance = $2 where id = $1',
      [userId, Number(balance.rows[0].credit_balance) - 1]
    );
  }))
);

const balance = await sql('select credit_balance from app_users where id = $1', [userId]);
assert.equal(Number(balance.rows[0].credit_balance), 980);

let rolledBack = false;
try {
  await withTransaction(async (client) => {
    await client.query(
      'update brands set company_name = $2 where id = $1',
      [brandId, 'This update must roll back']
    );
    throw new Error('EXPECTED_ROLLBACK');
  });
} catch (error) {
  rolledBack = error instanceof Error && error.message === 'EXPECTED_ROLLBACK';
}
assert.equal(rolledBack, true);

const brand = await sql(
  'select company_name from brands where id = $1 and lower(trim(domain)) = lower(trim($2))',
  [brandId, `runtime-${suffix}.example`]
);
assert.equal(brand.rows[0].company_name, 'Runtime Brand');

await sql('delete from app_users where id = $1', [userId]);
const remaining = await sql('select count(*)::integer as count from brands where id = $1', [brandId]);
assert.equal(Number(remaining.rows[0].count), 0);

console.log('SQLite runtime adapter verification passed.');
