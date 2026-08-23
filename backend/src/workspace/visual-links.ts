import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { campaignVisualLinks } from '../db/schema/workspace.js';

export type AddVisualLinkResult =
  | { ok: true; id: string; url: string }
  | { ok: false; code: 'url_malformed' | 'url_duplicate'; message: string };

function normalizedWebUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return null;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && (current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Saves a reference only. It is never promoted to verified upload evidence. */
export async function addVisualLink(
  db: Database,
  input: { campaignId: string; url: string; actor: string },
): Promise<AddVisualLinkResult> {
  const url = normalizedWebUrl(input.url);
  if (!url) {
    return {
      ok: false,
      code: 'url_malformed',
      message: 'Enter a complete http or https web address.',
    };
  }

  try {
    const [row] = await db
      .insert(campaignVisualLinks)
      .values({ campaignId: input.campaignId, url, createdBy: input.actor })
      .returning({ id: campaignVisualLinks.id });
    return { ok: true, id: row!.id, url };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        code: 'url_duplicate',
        message: 'That link is already attached to this campaign.',
      };
    }
    throw error;
  }
}

export async function removeVisualLink(
  db: Database,
  input: { id: string; campaignId: string; actor: string },
): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(campaignVisualLinks)
    .set({ removedAt: now, removedBy: input.actor, updatedAt: now })
    .where(
      and(
        eq(campaignVisualLinks.id, input.id),
        eq(campaignVisualLinks.campaignId, input.campaignId),
      ),
    )
    .returning({ id: campaignVisualLinks.id });
  return updated.length > 0;
}
