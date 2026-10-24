import { FOUNDER_EMAIL_KEYS, type FounderEmailKey, type FounderEmailTemplate, type FounderEmailRendered } from './types.js';
import type { Database } from '../../db/client.js';
import { renderFounderInvitation, type InvitationVariables } from '../templates/founder-invitation.js';
import { INVITATION_ART_PATH, PROOVD_LOGO_PATH } from '../templates/email-art.js';
import { renderFounderInvitation as renderPreviousInvitation } from './previous-invitation.js';
import { renderEmailCodeNotice } from '../../vetting/email-code.js';
import type { PlainNoticeVariables } from '../templates/plain.js';
import { renderFounderApplicationNotice, type FounderApplicationEmailKey } from './application.js';
import { FOUNDER_EMAIL_DEFINITIONS, validateFounderEmailCopy } from './definitions.js';
import { readFounderEmailRecord } from './store.js';
import { removeEmailEmDashes } from '../send.js';
import type { FounderEmailPreviewAssets } from './preview-assets.js';

function sentCopy(message: FounderEmailRendered): FounderEmailRendered {
  return { subject: removeEmailEmDashes(message.subject), html: removeEmailEmDashes(message.html), text: removeEmailEmDashes(message.text) };
}

/** Fictional details shared by both versions. These URLs cannot access a real account. */
const invitationSample: InvitationVariables = {
  recipientName: 'Alex', productName: 'Fieldnotes', productUrl: 'https://fieldnotes.example',
  whatWeUnderstood: 'A digital workspace that helps independent researchers organize their notes.',
  whyInvited: 'We discussed the product and your plans on our call.',
  senderName: 'Sam', senderEmail: 'support@proovd.co', expectedSetupTime: 'about 25 minutes',
  draftUrl: 'https://preview.invalid/founder-invitation', reference: 'SAMPLE-FOUNDER', supportEmail: 'support@proovd.co',
  // Preview-only assets resolve on the current app origin, including local/staging.
  // Actual delivered emails still receive absolute deployment URLs from the workflow.
  artUrl: INVITATION_ART_PATH, logoUrl: PROOVD_LOGO_PATH,
};
const codeSample = { code: '123456', reference: 'SAMPLE-FOUNDER', supportEmail: 'support@proovd.co', founderName: 'Alex', companyName: 'Fieldnotes' };

function applicationSample(key: FounderApplicationEmailKey): PlainNoticeVariables {
  const definition = FOUNDER_EMAIL_DEFINITIONS[key];
  const facts = [{ label: 'Campaign', value: 'Fieldnotes' }];
  switch (key) {
    case 'founder_application_review_received':
      facts.push({ label: 'Application round', value: '1' }, { label: 'Who owns the next step', value: 'Proovd' }, { label: 'What happens next', value: 'An Admin reviews the application and records a decision or an exact request.' });
      break;
    case 'founder_application_information_needed':
      facts.push({ label: 'What we need', value: 'Please clarify which customers will use Fieldnotes first.' }, { label: 'Who owns the next step', value: 'You' });
      break;
    case 'founder_application_changes_requested':
      facts.push({ label: 'Field', value: 'Product description' }, { label: 'Requested change', value: 'Please add the specific outcome the customer receives.' }, { label: 'Who owns the next step', value: 'You' });
      break;
    case 'founder_application_approved':
      facts.push({ label: 'What happens next', value: 'Continue to the listing-fee step.' });
      break;
    case 'founder_application_rejected':
      facts.push({ label: 'Decision explanation', value: 'The application does not currently provide enough evidence of the proposed digital product.' });
      break;
  }
  return { subject: definition.defaultCopy.subject!, headline: definition.defaultCopy.headline!, facts, action: { label: definition.defaultCopy.actionLabel!, url: 'https://preview.invalid/application-review' }, reference: 'SAMPLE-REVIEW', supportEmail: 'support@proovd.co' };
}

export async function renderFounderEmailVersions(key: FounderEmailKey, copy: Record<string, string>, previewAssets?: FounderEmailPreviewAssets) {
  if (key === 'founder_invitation') {
    const sample = { ...invitationSample, ...previewAssets };
    const [current, previous] = await Promise.all([renderFounderInvitation(sample, copy), renderPreviousInvitation(sample)]);
    return { current: sentCopy(current), previous: sentCopy(previous) };
  }
  if (key === 'founder_email_code') {
    const previousCopy = { ...FOUNDER_EMAIL_DEFINITIONS[key].defaultCopy,
      instruction: "Type it into proovd to confirm it's you. It expires in 10 minutes.",
      preheader: "Type it in to confirm it's you it expires in 10 minutes.",
    };
    const [current, previous] = await Promise.all([renderEmailCodeNotice(codeSample, copy), renderEmailCodeNotice(codeSample, previousCopy)]);
    return { current: sentCopy(current), previous: sentCopy(previous) };
  }
  const base = applicationSample(key);
  const [current, previous] = await Promise.all([renderFounderApplicationNotice(key, base, copy), renderFounderApplicationNotice(key, base, FOUNDER_EMAIL_DEFINITIONS[key].defaultCopy)]);
  return { current: sentCopy(current), previous: sentCopy(previous) };
}

export async function readFounderEmailTemplate(db: Database, key: FounderEmailKey, previewAssets?: FounderEmailPreviewAssets): Promise<FounderEmailTemplate> {
  const definition = FOUNDER_EMAIL_DEFINITIONS[key];
  const record = await readFounderEmailRecord(db, key);
  const copy = record ? validateFounderEmailCopy(key, record.copy) : { ...definition.defaultCopy };
  return {
    key, title: definition.title, description: definition.description, fields: definition.fields,
    copy, defaultCopy: definition.defaultCopy, version: record?.version ?? 0,
    updatedAt: record?.updatedAt.toISOString() ?? null, updatedBy: record?.updatedBy ?? null, changeNote: record?.changeNote ?? null,
    notes: definition.notes, variables: definition.variables,
    ...await renderFounderEmailVersions(key, copy, previewAssets),
  };
}

export async function listFounderEmailTemplates(db: Database, previewAssets?: FounderEmailPreviewAssets): Promise<FounderEmailTemplate[]> {
  return Promise.all(FOUNDER_EMAIL_KEYS.map((key) => readFounderEmailTemplate(db, key, previewAssets)));
}
