import type { FounderEmailKey } from './types.js';
import type { Database } from '../../db/client.js';
import { renderPlainNotice, type PlainNoticeVariables } from '../templates/plain.js';
import { resolveFounderEmailCopy } from './definitions.js';
import { readFounderEmailCopy } from './store.js';

export type FounderApplicationEmailKey = Exclude<FounderEmailKey, 'founder_invitation' | 'founder_email_code'>;

/** Dynamic review facts and real action URLs are supplied only by the workflow. */
export function renderFounderApplicationNotice(key: FounderApplicationEmailKey, input: PlainNoticeVariables, copy?: Record<string, string>) {
  const productName = input.facts.find((fact) => fact.label === 'Campaign')?.value ?? 'your campaign';
  const messageCopy = resolveFounderEmailCopy(key, copy, { productName });
  return renderPlainNotice({
    ...input,
    subject: messageCopy.subject!,
    headline: messageCopy.headline!,
    paragraphs: [...(input.paragraphs ?? []), ...(messageCopy.body ? [messageCopy.body] : [])],
    action: input.action ? { ...input.action, label: messageCopy.actionLabel! } : undefined,
  });
}

export async function renderStoredFounderApplicationNotice(db: Database, key: FounderApplicationEmailKey, input: PlainNoticeVariables) {
  return renderFounderApplicationNotice(key, input, await readFounderEmailCopy(db, key));
}
