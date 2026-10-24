import { describe, expect, expectTypeOf, it } from 'vitest';
import { FOUNDER_EMAIL_KEYS, type FounderEmailTemplate as SharedFounderEmailTemplate } from '@proovd/shared';
import { FOUNDER_EMAIL_KEYS as SERVER_EMAIL_KEYS, type FounderEmailTemplate as ServerFounderEmailTemplate } from './types.js';
import { FOUNDER_EMAIL_DEFINITIONS, FounderEmailCopyError, validateFounderEmailCopy } from './definitions.js';
import { renderFounderEmailVersions } from './service.js';
import { renderFounderInvitation, type InvitationVariables } from '../templates/founder-invitation.js';
import { renderFounderApplicationNotice } from './application.js';

const invitation: InvitationVariables = {
  recipientName: 'Jamie <script>', productName: 'Notes & More', productUrl: null,
  whatWeUnderstood: 'Notes', whyInvited: 'A real call', senderName: 'Sam', senderEmail: 'support@proovd.co',
  expectedSetupTime: '25 minutes', draftUrl: 'https://preview.invalid/private', reference: 'SAMPLE', supportEmail: 'support@proovd.co', logoUrl: 'https://preview.invalid/logo.png', artUrl: 'https://preview.invalid/art.png',
};

describe('Founder email copy editor', () => {
  it('keeps the deployable server contract aligned with the shared browser contract', () => {
    expect(SERVER_EMAIL_KEYS).toEqual(FOUNDER_EMAIL_KEYS);
    expectTypeOf<ServerFounderEmailTemplate>().toEqualTypeOf<SharedFounderEmailTemplate>();
  });
  it('accepts every shipping default and rejects unsupported keys, variables, HTML, links, and header injection', () => {
    for (const key of FOUNDER_EMAIL_KEYS) expect(validateFounderEmailCopy(key, FOUNDER_EMAIL_DEFINITIONS[key].defaultCopy)).toEqual(FOUNDER_EMAIL_DEFINITIONS[key].defaultCopy);
    const base = FOUNDER_EMAIL_DEFINITIONS.founder_invitation.defaultCopy;
    for (const changed of [
      { ...base, extra: 'hidden override' },
      { ...base, body: 'Hello {{secureToken}}' },
      { ...base, body: '<img src="https://example.com/track">' },
      { ...base, body: 'Go to https://example.com' },
      { ...base, subject: 'Hi {{productName}}\r\nBcc: attacker@example.com' },
      { ...base, subject: 'Generic invitation' },
      { ...base, body: 'Malformed {{productName}' },
    ]) expect(() => validateFounderEmailCopy('founder_invitation', changed)).toThrow(FounderEmailCopyError);
    expect(() => validateFounderEmailCopy('founder_email_code', { ...FOUNDER_EMAIL_DEFINITIONS.founder_email_code.defaultCopy, instruction: 'This expires in 10 minutes.' })).toThrow(FounderEmailCopyError);
  });

  it('renders the actual old artwork and button alongside the current text-first formatting', async () => {
    const versions = await renderFounderEmailVersions('founder_invitation', FOUNDER_EMAIL_DEFINITIONS.founder_invitation.defaultCopy);
    expect(versions.previous.subject).toBe("Alex, Fieldnotes's first campaign is set up, come claim it");
    expect(versions.current.subject).toBe('Your Proovd invitation for Fieldnotes');
    expect(versions.previous.html).toContain('<img');
    expect(versions.previous.html).toContain('email-invite-email.png');
    expect(versions.previous.html).toContain('src="/assets/proovd-logo.png"');
    expect(versions.previous.html).not.toContain('https://app.proovd.co/assets/');
    expect(versions.current.html).not.toContain('<img');
    expect(versions.current.html).toContain('text-decoration:underline');
    expect(versions.current.text).toContain('It came out of our call');
    expect(versions.current.text).toContain('https://preview.invalid/founder-invitation');
    expect(versions.previous.text).toContain('https://preview.invalid/founder-invitation');
  });

  it('uses the saved copy with real variables while preserving secure URLs, notices, and HTML escaping', async () => {
    const copy = { ...FOUNDER_EMAIL_DEFINITIONS.founder_invitation.defaultCopy, subject: 'After our call: {{productName}}', body: 'A first paragraph.\n\nA second paragraph.', actionLabel: 'Open your prepared invitation' };
    const result = await renderFounderInvitation(invitation, validateFounderEmailCopy('founder_invitation', copy));
    expect(result.subject).toBe('After our call: Notes & More');
    expect(result.html).toContain('Jamie &lt;script&gt;');
    expect(result.html).not.toContain('Jamie <script>');
    expect(result.text).toContain('A first paragraph.\n\nA second paragraph.');
    expect(result.html).toContain('https://preview.invalid/private');
    expect(result.text).toContain('nothing is charged');
    expect(result.text).toContain('Proovd will never ask');
    expect(result.unresolved).toEqual([]);
  });

  it('keeps the old 10-minute copy visible and derives current expiry from the real code lifetime', async () => {
    const versions = await renderFounderEmailVersions('founder_email_code', FOUNDER_EMAIL_DEFINITIONS.founder_email_code.defaultCopy);
    expect(versions.previous.text).toContain('expires in 10 minutes');
    expect(versions.current.text).toContain('expires in 15 minutes');
    expect(versions.current.text).toContain('123 456');
    expect(versions.current.text).toContain("Didn't ask for a code?");
  });

  it('applies review copy while retaining real decision facts and the workflow-owned destination', async () => {
    const base = FOUNDER_EMAIL_DEFINITIONS.founder_application_changes_requested.defaultCopy;
    const copy = validateFounderEmailCopy('founder_application_changes_requested', { ...base, subject: 'Next step for {{productName}}', headline: 'We need one update.', body: 'Here is some extra context.', actionLabel: 'Review the requested update' });
    const result = await renderFounderApplicationNotice('founder_application_changes_requested', {
      subject: 'original', headline: 'original', facts: [{ label: 'Campaign', value: 'Actual product' }, { label: 'Requested change', value: 'Keep this exact reason.' }],
      action: { label: 'original', url: 'https://preview.invalid/real-destination' }, reference: 'actual-reference', supportEmail: 'support@proovd.co',
    }, copy);
    expect(result.subject).toBe('Next step for Actual product');
    expect(result.text).toContain('Keep this exact reason.');
    expect(result.text).toContain('Here is some extra context.');
    expect(result.text).toContain('https://preview.invalid/real-destination');
    expect(result.text).toContain('actual-reference');
  });
});
