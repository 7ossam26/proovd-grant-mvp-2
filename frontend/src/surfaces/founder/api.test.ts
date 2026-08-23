import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheFounderWorkspace,
  clearFounderWorkspaceCache,
  fetchWorkspace,
  type WorkspaceState,
} from './api.js';

describe('Founder workspace navigation cache', () => {
  beforeEach(() => clearFounderWorkspaceCache());

  afterEach(() => {
    clearFounderWorkspaceCache();
    vi.unstubAllGlobals();
  });

  it('returns the latest control-mutation workspace on the next page read', async () => {
    const original = {
      workspace: { campaignId: 'campaign-1', fee: { subtotalCents: '3500' } } as WorkspaceState,
    };
    const latest = {
      workspace: { campaignId: 'campaign-1', fee: { subtotalCents: '3300' } } as WorkspaceState,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => original,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWorkspace('campaign-1')).resolves.toBe(original);
    cacheFounderWorkspace('campaign-1', latest);
    await expect(fetchWorkspace('campaign-1')).resolves.toBe(latest);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
