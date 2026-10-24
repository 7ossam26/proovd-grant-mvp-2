/** Global Founder onboarding copy. Secure links and operational facts stay server-owned. */
export const FOUNDER_EMAIL_KEYS = [
  'founder_invitation',
  'founder_email_code',
  'founder_application_review_received',
  'founder_application_information_needed',
  'founder_application_changes_requested',
  'founder_application_approved',
  'founder_application_rejected',
] as const;

export type FounderEmailKey = (typeof FOUNDER_EMAIL_KEYS)[number];
export interface FounderEmailField {
  key: string;
  label: string;
  kind: 'text' | 'textarea';
  help?: string;
  required: boolean;
}
export interface FounderEmailRendered { subject: string; html: string; text: string }
export interface FounderEmailTemplate {
  key: FounderEmailKey;
  title: string;
  description: string;
  fields: FounderEmailField[];
  copy: Record<string, string>;
  defaultCopy: Record<string, string>;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  changeNote: string | null;
  notes: string[];
  variables: Array<{ key: string; label: string }>;
  current: FounderEmailRendered;
  previous: FounderEmailRendered;
}
