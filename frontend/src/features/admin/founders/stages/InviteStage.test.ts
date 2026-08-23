import { describe, expect, it } from 'vitest';
import { inviteFieldsReady, type InviteFieldSnapshot } from './InviteStage.js';

const COMPLETE: InviteFieldSnapshot = {
  name: 'Mohsen',
  business: 'Mohsen Labs',
  problem: 'People cannot find the right supplier.',
  solution: 'A searchable, verified marketplace.',
  views: '10000',
  email: 'mohsen@example.com',
  username: 'mohsen4',
  matches: '5',
  affiliateType: 'social_media_creator',
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
  });
});
