import { describe, expect, it } from 'vitest';
import { decideItems, type WorkspaceSnapshot } from '../workspace/evidence.js';
import { imageIsPlaceholder } from '../workspace/uploads.js';
import { normalizeSocialUrl } from '../workspace/socials.js';

function snapshot(colors: string | null): WorkspaceSnapshot {
  return {
    assets: [
      {
        id: 'approved-logo',
        purpose: 'logo',
        state: 'stored',
        rejection: null,
        approved: true,
        removed: false,
      },
    ],
    socials: [],
    brand: { colors, typography: null, approved: false },
    story: { text: null, approved: false },
    interview: { status: null },
    invalidated: {},
  };
}

describe('the visible branding discount controls', () => {
  it('qualifies with saved colours and an approved stored logo', () => {
    const branding = decideItems(snapshot('#41ED98 — primary')).find(
      (item) => item.item === 'branding',
    );

    expect(branding).toMatchObject({ complete: true, rejections: [] });
  });

  it('still requires campaign colours', () => {
    const branding = decideItems(snapshot(null)).find((item) => item.item === 'branding');

    expect(branding).toMatchObject({ complete: false, rejections: ['nothing_supplied'] });
  });
});

describe('Founder actions that earn optional-item discounts', () => {
  it('counts a written story without a second hidden approval action', () => {
    const state = snapshot('#41ED98');
    state.story = { text: 'We built this after seeing the same problem every week.', approved: false };

    expect(decideItems(state).find((item) => item.item === 'story')).toMatchObject({
      complete: true,
      rejections: [],
    });
  });

  it('counts a saved interview selection', () => {
    const state = snapshot('#41ED98');
    state.interview = { status: 'selected' };

    expect(decideItems(state).find((item) => item.item === 'interview')).toMatchObject({
      complete: true,
      rejections: [],
    });
  });

  it('counts a normalized social URL the Founder confirms they control', () => {
    const state = snapshot('#41ED98');
    state.socials = [
      {
        id: 'social-1',
        url: 'https://instagram.com/proovd',
        accessible: false,
        controlsConfirmed: true,
        rejection: 'url_unreachable',
        removed: false,
      },
    ];

    expect(decideItems(state).find((item) => item.item === 'socials')).toMatchObject({
      complete: true,
      rejections: [],
    });
  });
});

describe('input normalization and upload validation', () => {
  it('adds https to an ordinary social address', () => {
    expect(normalizeSocialUrl(' instagram.com/proovd ')).toBe('https://instagram.com/proovd');
  });

  it('allows a compact logo while retaining the campaign-visual size floor', () => {
    expect(imageIsPlaceholder('logo', 82, 100)).toBe(false);
    expect(imageIsPlaceholder('visual', 82, 100)).toBe(true);
  });
});
