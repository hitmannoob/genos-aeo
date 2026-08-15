import 'server-only';

import { randomUUID } from 'crypto';
import { withTransaction } from '@/lib/db/sqlite';
export {
  USER_QUERY_CREDIT_COST,
  BRAND_CREATION_CREDIT_COST,
  QUERY_GENERATION_CREDIT_COST,
  COMPANY_INFO_CREDIT_COST,
} from './creditCosts';

export interface CreditMutationResult {
  before: number;
  after: number;
  deducted: number;
}

interface CreditLedgerOptions {
  idempotencyKey?: string;
  reason?: string;
  brandId?: string;
  queryRunId?: string;
  executionRequestId?: string;
  metadata?: Record<string, unknown>;
}

function assertCreditAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('INVALID_CREDIT_AMOUNT');
  }
}

export async function getUserCreditBalanceServer(userId: string): Promise<number> {
  return withTransaction(async (client) => {
    const result = await client.query<{ credit_balance: number }>(
      'select credit_balance from app_users where firebase_uid = $1 limit 1',
      [userId]
    );

    if (!result.rows[0]) {
      throw new Error('USER_NOT_FOUND');
    }

    return Number(result.rows[0].credit_balance ?? 0);
  });
}

export async function requireSufficientCreditsServer(
  userId: string,
  amount: number
): Promise<number> {
  assertCreditAmount(amount);
  const credits = await getUserCreditBalanceServer(userId);
  if (credits < amount) {
    throw new Error('INSUFFICIENT_CREDITS');
  }
  return credits;
}

export async function deductUserCreditsServer(
  userId: string,
  amount: number,
  options: CreditLedgerOptions = {}
): Promise<CreditMutationResult> {
  assertCreditAmount(amount);

  if (amount === 0) {
    const credits = await getUserCreditBalanceServer(userId);
    return {
      before: credits,
      after: credits,
      deducted: 0,
    };
  }

  return withTransaction(async (client) => {
    const userResult = await client.query<{
      id: string;
      credit_balance: number;
    }>(
      `
        select id, credit_balance
        from app_users
        where firebase_uid = $1
        for update
      `,
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    const idempotencyKey = options.idempotencyKey ?? `${options.reason ?? 'debit'}:${randomUUID()}`;
    const existingLedger = await client.query<{
      amount: number;
      balance_after: number;
    }>(
      `
        select amount, balance_after
        from credit_ledger
        where user_id = $1 and idempotency_key = $2
        limit 1
      `,
      [user.id, idempotencyKey]
    );

    if (existingLedger.rows[0]) {
      const existingAmount = Number(existingLedger.rows[0].amount);
      const existingBalanceAfter = Number(existingLedger.rows[0].balance_after);
      if (existingAmount !== -amount) {
        throw new Error('CREDIT_IDEMPOTENCY_CONFLICT');
      }

      return {
        before: existingBalanceAfter + amount,
        after: existingBalanceAfter,
        deducted: amount,
      };
    }

    const currentCredits = Number(user.credit_balance ?? 0);
    if (currentCredits < amount) {
      throw new Error('INSUFFICIENT_CREDITS');
    }

    const balanceAfter = currentCredits - amount;

    await client.query(
      `
        update app_users
        set credit_balance = $2
        where id = $1
      `,
      [user.id, balanceAfter]
    );

    await client.query(
      `
        insert into credit_ledger (
          user_id,
          brand_id,
          query_run_id,
          execution_request_id,
          idempotency_key,
          entry_type,
          amount,
          balance_after,
          reason,
          metadata
        )
        values ($1, $2, $3, $4, $5, 'debit', $6, $7, $8, $9::jsonb)
      `,
      [
        user.id,
        options.brandId ?? null,
        options.queryRunId ?? null,
        options.executionRequestId ?? null,
        idempotencyKey,
        -amount,
        balanceAfter,
        options.reason ?? 'credit debit',
        JSON.stringify(options.metadata ?? {}),
      ]
    );

    return {
      before: currentCredits,
      after: balanceAfter,
      deducted: amount,
    };
  });
}

export async function refundUserCreditsServer(
  userId: string,
  amount: number,
  options: CreditLedgerOptions = {}
): Promise<void> {
  assertCreditAmount(amount);
  if (amount === 0) return;

  await withTransaction(async (client) => {
    const userResult = await client.query<{
      id: string;
      credit_balance: number;
    }>(
      `
        select id, credit_balance
        from app_users
        where firebase_uid = $1
        for update
      `,
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }

    const idempotencyKey = options.idempotencyKey ?? `${options.reason ?? 'refund'}:${randomUUID()}`;
    const existingLedger = await client.query(
      `
        select 1
        from credit_ledger
        where user_id = $1 and idempotency_key = $2
        limit 1
      `,
      [user.id, idempotencyKey]
    );

    if (existingLedger.rows[0]) {
      return;
    }

    const balanceAfter = Number(user.credit_balance ?? 0) + amount;

    await client.query(
      `
        update app_users
        set credit_balance = $2
        where id = $1
      `,
      [user.id, balanceAfter]
    );

    await client.query(
      `
        insert into credit_ledger (
          user_id,
          brand_id,
          query_run_id,
          execution_request_id,
          idempotency_key,
          entry_type,
          amount,
          balance_after,
          reason,
          metadata
        )
        values ($1, $2, $3, $4, $5, 'refund', $6, $7, $8, $9::jsonb)
      `,
      [
        user.id,
        options.brandId ?? null,
        options.queryRunId ?? null,
        options.executionRequestId ?? null,
        idempotencyKey,
        amount,
        balanceAfter,
        options.reason ?? 'credit refund',
        JSON.stringify(options.metadata ?? {}),
      ]
    );
  });
}
