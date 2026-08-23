import { describe, expect, it } from 'vitest';
import { inviteFieldsReady, type InviteFieldSnapshot } from './InviteStage.js';
import { readPanel } from './recordGroup.js';

const COMPLETE: InviteFieldSnapshot = {
  name: 'Mohsen',
  business: 'Mohsen Labs',
  problem: 'People cannot find the right supplier.',
  solution: 'A searchable, verified marketplace.',
  views: '10000',
  email: 'mohsen@example.com',
  username: 'mohsen4',
  matches: '5',
  affiliateTypes: Array.from({ length: 5 }, () => 'social_media_creator'),
  voice1: 'fun',
  voice2: 'lucky',
};

describe('Invite-stage Send button readiness', () => {
  it('enables after all eleven visible fields are valid', () => {
    expect(inviteFieldsReady(COMPLETE)).toBe(true);
  });

  it('stays disabled for a blank field, invalid email, or invalid count', () => {
    expect(inviteFieldsReady({ ...COMPLETE, voice2: '' })).toBe(false);
    expect(inviteFieldsReady({ ...COMPLETE, email: 'not-an-email' })).toBe(false);
    expect(inviteFieldsReady({ ...COMPLETE, matches: '2.5' })).toBe(false);
    expect(inviteFieldsReady({ ...COMPLETE, affiliateTypes: ['podcast_host'] })).toBe(false);
  });
});

describe('Invite-stage saved values', () => {
  it('adapts the server panel response into the fields the stage reads', () => {
    const panel = readPanel({
      invitePrefills: {
        viewsCount: 10_000,
        affiliateMatches: 5,
        affiliateType: 'social_media_creator',
        affiliateTypes: [
          'social_media_creator',
          'social_media_creator',
          'podcast_host',
          'community_owner',
          'blog_operator',
        ],
        brandVoice1: 'fun',
        brandVoice2: 'lucky',
      },
      identity: {
        username: 'mohsen4',
        emailCodeVerifiedAt: '2026-08-23T10:00:00.000Z',
        passwordSetAt: null,
      },
      account: {
        dateOfBirth: '1990-01-31',
        ageCheck: '18 or older',
      },
    });

    expect(panel.prefills).toMatchObject({
      viewsCount: 10_000,
      affiliateMatches: 5,
      affiliateType: 'social_media_creator',
      affiliateTypes: [
        'social_media_creator',
        'social_media_creator',
        'podcast_host',
        'community_owner',
        'blog_operator',
      ],
      brandVoice1: 'fun',
      brandVoice2: 'lucky',
      username: 'mohsen4',
    });
    expect(panel.account).toMatchObject({
      emailVerifiedAt: '2026-08-23T10:00:00.000Z',
      passwordSetAt: null,
      dateOfBirth: '1990-01-31',
      ageCheck: '18 or older',
    });
  });
});
