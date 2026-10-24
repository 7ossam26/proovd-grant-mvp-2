import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFounderEmailPreviewAssets, FounderEmailPreviewAssetsUnavailable } from './preview-assets.js';
import { renderFounderEmailVersions } from './service.js';
import { FOUNDER_EMAIL_DEFINITIONS } from './definitions.js';

describe('self-contained historical email artwork', () => {
  it('embeds only the two trusted PNG assets and caches the loaded data', async () => {
    const directory = fileURLToPath(new URL('../../../../frontend/public', import.meta.url));
    const first = loadFounderEmailPreviewAssets(directory);
    expect(loadFounderEmailPreviewAssets(directory)).toBe(first);
    const assets = await first;
    expect(Object.keys(assets).sort()).toEqual(['artUrl', 'logoUrl']);
    expect(assets.artUrl).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(assets.logoUrl).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    const rendered = await renderFounderEmailVersions('founder_invitation', FOUNDER_EMAIL_DEFINITIONS.founder_invitation.defaultCopy, assets);
    expect(rendered.previous.html).toContain(`src="${assets.logoUrl}"`);
    expect(rendered.previous.html).toContain(`src="${assets.artUrl}"`);
    expect(rendered.previous.html).not.toContain('src="/assets/');
    expect(rendered.current.html).not.toContain('<img');
  });

  it('fails explicitly when a configured static-asset directory is missing', async () => {
    const directory = fileURLToPath(new URL('./missing-preview-assets', import.meta.url));
    await expect(loadFounderEmailPreviewAssets(directory)).rejects.toBeInstanceOf(FounderEmailPreviewAssetsUnavailable);
  });
});
