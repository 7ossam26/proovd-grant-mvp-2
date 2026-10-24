import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { INVITATION_ART_PATH, PROOVD_LOGO_PATH } from '../templates/email-art.js';

export interface FounderEmailPreviewAssets { artUrl: string; logoUrl: string }
export class FounderEmailPreviewAssetsUnavailable extends Error {
  constructor() { super('The original email artwork could not be loaded. No template changes were saved.'); }
}
const cache = new Map<string, Promise<FounderEmailPreviewAssets>>();

/** Only two trusted static assets can be embedded; no request-supplied path is read. */
export function loadFounderEmailPreviewAssets(publicDir: string): Promise<FounderEmailPreviewAssets> {
  const directory = resolve(publicDir);
  const cached = cache.get(directory);
  if (cached) return cached;
  const readPng = async (assetPath: string) => {
    const bytes = await readFile(resolve(directory, `.${assetPath}`));
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid preview asset');
    return `data:image/png;base64,${bytes.toString('base64')}`;
  };
  const pending = Promise.all([readPng(INVITATION_ART_PATH), readPng(PROOVD_LOGO_PATH)])
    .then(([artUrl, logoUrl]) => ({ artUrl, logoUrl }))
    .catch(() => { cache.delete(directory); throw new FounderEmailPreviewAssetsUnavailable(); });
  cache.set(directory, pending);
  return pending;
}
