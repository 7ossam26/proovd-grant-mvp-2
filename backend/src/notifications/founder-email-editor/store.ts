import { eq, sql } from 'drizzle-orm';
import type { FounderEmailKey } from './types.js';
import type { Database } from '../../db/client.js';
import type { AuditWriter } from '../../auth/audit.js';
import { founderEmailTemplates } from '../../db/schema/founder-email-templates.js';
import { FOUNDER_EMAIL_DEFINITIONS, validateFounderEmailCopy } from './definitions.js';

export type FounderEmailReader = Pick<Database, 'select'>;

export async function readFounderEmailCopy(db: FounderEmailReader, key: FounderEmailKey): Promise<Record<string, string>> {
  const record = await readFounderEmailRecord(db, key);
  return record ? validateFounderEmailCopy(key, record.copy) : { ...FOUNDER_EMAIL_DEFINITIONS[key].defaultCopy };
}

export async function readFounderEmailRecord(db: FounderEmailReader, key: FounderEmailKey) {
  const [record] = await db.select().from(founderEmailTemplates).where(eq(founderEmailTemplates.key, key)).limit(1);
  return record ?? null;
}

export class FounderEmailVersionConflict extends Error {}

export async function saveFounderEmailCopy(db: Database, audit: AuditWriter, input: {
  key: FounderEmailKey; copy: Record<string, string>; version: number; changeNote: string; actorId: string;
}) {
  const copy = validateFounderEmailCopy(input.key, input.copy);
  return db.transaction(async (tx) => {
    // Serialize both the initial insert and later edits without relying on a browser check.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`founder-email-copy:${input.key}`}, 0))`);
    const existing = await readFounderEmailRecord(tx, input.key);
    if ((existing?.version ?? 0) !== input.version) throw new FounderEmailVersionConflict();
    const version = input.version + 1;
    const updatedAt = new Date();
    const changeNote = input.changeNote.trim() || `Updated ${FOUNDER_EMAIL_DEFINITIONS[input.key].title.toLowerCase()} copy.`;
    const values = { key: input.key, copy, version, updatedAt, updatedBy: input.actorId, changeNote };
    const [record] = await tx.insert(founderEmailTemplates).values(values).onConflictDoUpdate({ target: founderEmailTemplates.key, set: values }).returning();
    await audit({
      actorId: input.actorId,
      action: 'founder_email_template.updated', targetType: 'founder_email_template', targetId: input.key,
      internalReason: changeNote,
      priorValue: { copy: existing?.copy ?? FOUNDER_EMAIL_DEFINITIONS[input.key].defaultCopy, version: input.version },
      newValue: { copy, version },
    }, tx);
    return record!;
  });
}
