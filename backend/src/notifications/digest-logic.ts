/**
 * `shared/src/notifications/digest.ts`, restated — Spec §27.7, §30.
 *
 * The backend cannot import `@proovd/shared` at runtime (see the header of
 * `contract-logic.ts` for the constraint and why the answer is always restate
 * and drift-test). `tests/notification-coverage.test.ts` fails the suite if the
 * two ever disagree.
 */

export const DIGEST_FREQUENCIES = ['daily', 'weekly'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export const DIGEST_PREFERENCES = ['off', ...DIGEST_FREQUENCIES] as const;
export type DigestPreference = (typeof DIGEST_PREFERENCES)[number];

export const DIGEST_AUDIENCES = ['founder', 'affiliate', 'backer'] as const;
export type DigestAudience = (typeof DIGEST_AUDIENCES)[number];

export function isDigestPreference(value: string): value is DigestPreference {
  return (DIGEST_PREFERENCES as readonly string[]).includes(value);
}

export function isDigestFrequency(value: string): value is DigestFrequency {
  return (DIGEST_FREQUENCIES as readonly string[]).includes(value);
}

export const DIGEST_NEVER_REPLACES_TRANSACTIONAL =
  'This is the only email you can turn off. Messages about your money, your deadlines, and your account always send.';

export const DIGEST_PROMPT_QUESTION = 'Would you like a summary of campaign activity?';

export const DIGEST_OPTION_LABELS: Record<DigestPreference, string> = {
  off: 'No summary emails',
  daily: 'Once a day',
  weekly: 'Once a week',
};

export interface EligibleActivity {
  specRef: string;
  audiences: readonly DigestAudience[];
  source: string;
  coveredBy: string | null;
  description: string;
}

export const DIGEST_ELIGIBLE_ACTIVITY = {
  campaign_update: {
    specRef: '§27.7, §18',
    audiences: ['backer', 'affiliate'],
    source: 'campaign_updates',
    coveredBy: null,
    description: 'A Founder posted a campaign update',
  },
  campaign_comment: {
    specRef: '§27.7, §18',
    audiences: ['founder'],
    source: 'campaign_comments',
    coveredBy: null,
    description: 'Someone commented on your campaign',
  },
  roster_change: {
    specRef: '§27.7, §14.5',
    audiences: ['founder'],
    source: 'association_status_history',
    coveredBy: 'founder_roster_update',
    description: 'A Creator’s status on your campaign changed',
  },
} as const satisfies Record<string, EligibleActivity>;

export type EligibleActivityKind = keyof typeof DIGEST_ELIGIBLE_ACTIVITY;

export const ELIGIBLE_ACTIVITY_KINDS = Object.keys(
  DIGEST_ELIGIBLE_ACTIVITY,
) as EligibleActivityKind[];

export function activityKindsFor(audience: DigestAudience): EligibleActivityKind[] {
  return ELIGIBLE_ACTIVITY_KINDS.filter((kind) =>
    (DIGEST_ELIGIBLE_ACTIVITY[kind].audiences as readonly string[]).includes(audience),
  );
}

export const DIGEST_WINDOW_HOURS: Record<DigestFrequency, number> = {
  daily: 24,
  weekly: 24 * 7,
};

export function digestPeriodKey(frequency: DigestFrequency, at: Date): string {
  const dayNumber = Math.floor(at.getTime() / 86_400_000);
  return frequency === 'daily' ? `daily:${dayNumber}` : `weekly:${Math.floor(dayNumber / 7)}`;
}

export function digestWindow(frequency: DigestFrequency, at: Date): { from: Date; to: Date } {
  return {
    from: new Date(at.getTime() - DIGEST_WINDOW_HOURS[frequency] * 3_600_000),
    to: at,
  };
}

export const DIGEST_PROHIBITIONS = {
  no_empty_send: {
    specRef: '§33.6.11, §30',
    rule: 'A digest with no eligible activity is not sent, and no delivery is recorded for it.',
  },
  no_transactional_content: {
    specRef: '§27.2',
    rule: 'No money message and no deadline message may appear as digest content.',
  },
  no_duplicate_of_a_sent_message: {
    specRef: '§27.2, §30',
    rule: 'An item whose covering transactional key already delivered to this person is excluded.',
  },
  no_default_on: {
    specRef: '§30',
    rule: 'No code path sets a frequency without a person choosing it.',
  },
  no_pressure_to_return: {
    specRef: '§30, DNA §5.5',
    rule: 'No streak, no absence notice, no "you have not visited" framing, no unread count.',
  },
} as const;

export const BANNED_DIGEST_TERMS: readonly string[] = [
  "haven't visited",
  'have not visited',
  'we miss you',
  'come back',
  'still interested',
  'streak',
  'don’t miss out',
  "don't miss out",
  'last chance',
  'act now',
  'unread',
  'you may have missed',
];

export const HISTORY_AUDIENCES = ['founder', 'affiliate', 'admin'] as const;
export type HistoryAudience = (typeof HISTORY_AUDIENCES)[number];

export const HISTORY_DELIVERY_STATES = {
  delivered: {
    specRef: '§27.2',
    label: 'Sent',
    description: 'The provider accepted the message.',
  },
  unconfirmed: {
    specRef: '§1.4',
    label: 'Sent — delivery not confirmed',
    description:
      'Proovd recorded the message and the provider did not confirm it. It may still have arrived.',
  },
} as const;

export type HistoryDeliveryState = keyof typeof HISTORY_DELIVERY_STATES;

export function historyStateFor(deliveredAt: Date | null): HistoryDeliveryState {
  return deliveredAt ? 'delivered' : 'unconfirmed';
}
