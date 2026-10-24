import { FOUNDER_EMAIL_KEYS, type FounderEmailField, type FounderEmailKey } from './types.js';

interface Definition {
  title: string;
  description: string;
  fields: FounderEmailField[];
  defaultCopy: Record<string, string>;
  variables: Array<{ key: string; label: string }>;
  notes: string[];
  requiredTokens?: Record<string, string[]>;
}
const field = (key: string, label: string, kind: 'text' | 'textarea' = 'text', required = true): FounderEmailField => ({ key, label, kind, required });
const variable = (key: string, label: string) => ({ key, label });
const reviewFields = [field('subject', 'Subject'), field('headline', 'Opening'), field('body', 'Additional message', 'textarea', false), field('actionLabel', 'Link label')];
const reviewVariables = [variable('productName', 'Product name')];
const unchangedNotes = ['The original copy and formatting are shown on the left. No built-in redesign was made to this email.', 'Saved edits apply to future messages. Decision details, campaign facts, secure links, and support information stay automatic.'];

export const FOUNDER_EMAIL_DEFINITIONS: Record<FounderEmailKey, Definition> = {
  founder_invitation: {
    title: 'Invitation', description: 'Sent after your call, inviting the Founder to review their prepared campaign.',
    fields: [field('subject', 'Subject'), field('preheader', 'Inbox preview'), field('greeting', 'Greeting'), field('intro', 'Opening'), field('body', 'Message', 'textarea'), field('actionLabel', 'Link label')],
    defaultCopy: {
      subject: 'Your Proovd invitation for {{productName}}',
      preheader: '{{senderName}} has sent your invitation for {{productName}}.',
      greeting: 'Hi {{recipientName}},',
      intro: 'Your Proovd invitation for {{productName}} is ready to review.',
      body: "It came out of our call, so most of it is filled in. Read it over, fix anything we got wrong, and it's yours.",
      actionLabel: 'Review your Proovd invitation',
    },
    variables: [variable('recipientName', 'Founder name'), variable('productName', 'Product name'), variable('senderName', 'Sender name')],
    requiredTokens: { subject: ['productName'] },
    notes: [
      'The subject now names the invitation and product. The original subject emphasized the campaign already being set up; neither version has a measured conversion advantage.',
      'The call paragraph stayed unchanged: every Founder invitation follows a real call.',
      'Decorative artwork, the logo, large headings, and the green button became a simple note with an underlined link.',
      'The personal-link explanation, sender, support route, reference, and safety notice are retained.',
      'App mail now uses Proovd <hello@mail.proovd.co>; the default reply route is support@proovd.co. Existing personal reply addresses still take precedence.',
    ],
  },
  founder_email_code: {
    title: 'Email verification code', description: 'Confirms the Founder’s email address during signup.',
    fields: [field('subject', 'Subject'), field('preheader', 'Inbox preview'), field('greeting', 'Greeting'), field('instruction', 'Instructions', 'textarea'), field('signoff', 'Sign-off')],
    defaultCopy: {
      subject: 'Your proovd confirmation code',
      preheader: "Type it in to confirm it's you it expires in {{expiryMinutes}} minutes.",
      greeting: '{{personalGreeting}}',
      instruction: "Type it into proovd to confirm it's you. It expires in {{expiryMinutes}} minutes.",
      signoff: '{{personalSignoff}}',
    },
    variables: [variable('personalGreeting', 'Personal greeting'), variable('personalSignoff', 'Personal sign-off'), variable('founderName', 'Founder name'), variable('companyName', 'Company name'), variable('expiryMinutes', 'Code validity in minutes')],
    requiredTokens: { instruction: ['expiryMinutes'] },
    notes: ['The previous email said 10 minutes. The current copy uses the actual 15-minute validity automatically; the code’s security lifetime is unchanged.', 'The verification code, ignore-if-unrequested notice, support route, and reference remain automatic.'],
  },
  founder_application_review_received: {
    title: 'Application received', description: 'Confirms an application was submitted for review.', fields: reviewFields,
    defaultCopy: { subject: 'We received your application — {{productName}}', headline: 'Your application is with Proovd.', body: '', actionLabel: 'View Application Review' }, variables: reviewVariables, notes: unchangedNotes,
  },
  founder_application_information_needed: {
    title: 'More information needed', description: 'Asks for the information recorded by the reviewing Admin.', fields: reviewFields,
    defaultCopy: { subject: 'We need more information about {{productName}}', headline: 'We need more information before we can finish the review.', body: '', actionLabel: 'Open Application Review' }, variables: reviewVariables, notes: unchangedNotes,
  },
  founder_application_changes_requested: {
    title: 'Application changes requested', description: 'Asks the Founder to update and resubmit their application.', fields: reviewFields,
    defaultCopy: { subject: 'Changes requested for {{productName}}', headline: 'Please update your application and resubmit it.', body: '', actionLabel: 'Update your application' }, variables: reviewVariables, notes: unchangedNotes,
  },
  founder_application_approved: {
    title: 'Application approved', description: 'Confirms application approval and links to the existing next setup step.', fields: reviewFields,
    defaultCopy: { subject: 'Your application is approved — {{productName}}', headline: 'Your application is approved.', body: '', actionLabel: 'Continue setup' }, variables: reviewVariables, notes: unchangedNotes,
  },
  founder_application_rejected: {
    title: 'Application decision', description: 'Shares a declined application decision and its recorded explanation.', fields: reviewFields,
    defaultCopy: { subject: 'Application Review decision — {{productName}}', headline: 'We cannot approve this application.', body: '', actionLabel: 'View the decision' }, variables: reviewVariables, notes: unchangedNotes,
  },
};

export function isFounderEmailKey(value: string): value is FounderEmailKey {
  return (FOUNDER_EMAIL_KEYS as readonly string[]).includes(value);
}

export class FounderEmailCopyError extends Error {
  constructor(public readonly fields: Record<string, string>) { super('Please check the highlighted email fields.'); }
}

/** Template syntax is deliberately text-only; React escapes substituted values. */
export function interpolateEmailCopy(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_match, key: string) => variables[key] ?? `[${key.toUpperCase()}]`);
}

export function resolveFounderEmailCopy(key: FounderEmailKey, copy: Record<string, string> | undefined, variables: Record<string, string>): Record<string, string> {
  const values = copy ?? FOUNDER_EMAIL_DEFINITIONS[key].defaultCopy;
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, interpolateEmailCopy(value, variables)]));
}

export function validateFounderEmailCopy(key: FounderEmailKey, value: unknown): Record<string, string> {
  const definition = FOUNDER_EMAIL_DEFINITIONS[key];
  const errors: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FounderEmailCopyError({ copy: 'Enter the email text.' });
  const record = value as Record<string, unknown>;
  const names = new Set(definition.fields.map((f) => f.key));
  for (const name of Object.keys(record)) if (!names.has(name)) errors[name] = 'This field is not editable.';
  const allowed = new Set(definition.variables.map((v) => v.key));
  const copy: Record<string, string> = {};
  for (const field of definition.fields) {
    const raw = record[field.key];
    if (typeof raw !== 'string') { errors[field.key] = 'Enter text for this field.'; continue; }
    const text = raw.trim();
    if (field.required && !text) errors[field.key] = 'This field is required.';
    const max = field.kind === 'textarea' ? 5000 : field.key === 'subject' ? 240 : 500;
    if (text.length > max) errors[field.key] = `Use no more than ${max} characters.`;
    if (field.kind === 'text' && /[\r\n]/.test(raw)) errors[field.key] = 'Use a single line.';
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) errors[field.key] = 'Remove control characters.';
    if (/<\/?[a-z][^>]*>/i.test(text) || /https?:\/\/|mailto:/i.test(text)) errors[field.key] = 'Use ordinary text. Secure links and addresses are added automatically.';
    const tokens = [...text.matchAll(/\{\{([^{}]*)\}\}/g)].map((match) => match[1]!);
    for (const token of tokens) if (!allowed.has(token)) errors[field.key] = `Unknown variable: ${token}.`;
    if (/[{}]/.test(text.replace(/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g, ''))) errors[field.key] = 'Use variables in the form {{productName}}.';
    for (const required of definition.requiredTokens?.[field.key] ?? []) {
      if (!text.includes(`{{${required}}}`)) errors[field.key] = `Keep {{${required}}} so each email has the correct value.`;
    }
    copy[field.key] = text;
  }
  if (Object.keys(errors).length) throw new FounderEmailCopyError(errors);
  return copy;
}
