import type { FounderEmailKey, FounderEmailRendered, FounderEmailTemplate } from '@proovd/shared';
import { call } from '../../api.js';

const BASE = '/api/admin/founder-emails';

export function fetchFounderEmails(): Promise<{ templates: FounderEmailTemplate[] }> {
  return call(BASE);
}

export function previewFounderEmail(key: FounderEmailKey, copy: Record<string, string>): Promise<{
  current: FounderEmailRendered;
  previous: FounderEmailRendered;
}> {
  return call(`${BASE}/${encodeURIComponent(key)}/preview`, {
    method: 'POST',
    body: JSON.stringify({ copy }),
  });
}

export function saveFounderEmail(
  key: FounderEmailKey,
  input: { copy: Record<string, string>; version: number; changeNote: string },
): Promise<{ template: FounderEmailTemplate }> {
  return call(`${BASE}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
