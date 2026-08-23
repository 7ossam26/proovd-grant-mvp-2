import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

export interface HardDeleteFounderInput {
  prospectId: string;
  confirmationEmail: string;
  reason: string;
  actor: string;
}

export interface HardDeleteFounderResult {
  legalName: string | null;
  email: string;
  campaignCount: number;
  deletedAccount: boolean;
  deletedRows: number;
}

/**
 * Calls migration 0068's narrow SECURITY DEFINER boundary. The database owns
 * the dependency walk and transaction so a failure can never leave half a
 * Founder behind.
 */
export async function hardDeleteFounder(
  db: Database,
  input: HardDeleteFounderInput,
): Promise<HardDeleteFounderResult> {
  const result = await db.execute(sql`
    SELECT *
    FROM hard_delete_founder(
      ${input.prospectId}::uuid,
      ${input.confirmationEmail},
      ${input.reason},
      ${input.actor}
    )
  `);
  const row = result.rows[0] as
    | {
        legal_name: string | null;
        email: string;
        campaign_count: number;
        deleted_account: boolean;
        deleted_rows: number | string | bigint;
      }
    | undefined;
  if (!row) throw new Error('Founder deletion returned no result');

  return {
    legalName: row.legal_name,
    email: row.email,
    campaignCount: Number(row.campaign_count),
    deletedAccount: row.deleted_account,
    deletedRows: Number(row.deleted_rows),
  };
}

export function postgresErrorCode(error: unknown): string | null {
  let cursor: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!cursor || typeof cursor !== 'object') return null;
    const record = cursor as { code?: unknown; cause?: unknown };
    if (typeof record.code === 'string') return record.code;
    cursor = record.cause;
  }
  return null;
}

