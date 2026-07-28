import 'server-only';

import { sql } from './postgres';
import type { UserProfile } from '@/types/userProfile';

export const LOCAL_USER_ID = 'local-user';

interface AppUserRow {
  id: string;
  firebase_uid: string;
  email: string;
  display_name: string;
  photo_url: string | null;
  credit_balance: number;
  is_new_user: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function appUserRowToProfile(row: AppUserRow): UserProfile {
  return {
    uid: row.firebase_uid,
    email: row.email,
    displayName: row.display_name,
    ...(row.photo_url && { photoURL: row.photo_url }),
    credits: Number(row.credit_balance ?? 0),
    createdAt: toIsoString(row.created_at),
    lastLoginAt: toIsoString(row.last_login_at),
    isNewUser: row.is_new_user,
  };
}

export async function getAppUserProfileByUserId(
  userId: string
): Promise<UserProfile | null> {
  const result = await sql<AppUserRow>(
    `
      select
        id,
        firebase_uid,
        email,
        display_name,
        photo_url,
        credit_balance,
        is_new_user,
        created_at,
        updated_at,
        last_login_at
      from app_users
      where firebase_uid = $1
      limit 1
    `,
    [userId]
  );

  return result.rows[0] ? appUserRowToProfile(result.rows[0]) : null;
}

export async function ensureLocalAppUserProfile(): Promise<UserProfile> {
  const result = await sql<AppUserRow>(
    `
      insert into app_users (
        firebase_uid,
        email,
        display_name,
        photo_url,
        is_new_user,
        last_login_at
      )
      values ($1, $2, $3, $4, true, now())
      on conflict (firebase_uid) do update set
        last_login_at = now()
      returning
        id,
        firebase_uid,
        email,
        display_name,
        photo_url,
        credit_balance,
        is_new_user,
        created_at,
        updated_at,
        last_login_at
    `,
    [
      LOCAL_USER_ID,
      'local@genos.local',
      'Local user',
      null,
    ]
  );

  return appUserRowToProfile(result.rows[0]);
}
