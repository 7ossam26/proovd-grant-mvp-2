/**
 * The optional digest and the notification history — Spec §27.7, §30, DNA §5.2,
 * §5.5.
 *
 * §27.7 is four sentences and one prohibition, and every one of them is a
 * constraint on what this may become rather than a feature request:
 *
 *   "Optional daily/weekly digest for eligible activity such as
 *    updates/comments/roster changes. Backer selects preference at first
 *    magic-link visit; Founder/Affiliate in settings. Authenticated
 *    Founder/Affiliate/Admin surfaces have notification history. Notification
 *    history does not turn Founder home into a widget dashboard or override the
 *    one ranked Act item. No real-time push required."
 *
 * ── The digest is the one opt-out-able message, so it may never carry a
 *    transactional one ────────────────────────────────────────────────────────
 * §27.2's first rule is that transactional email is not opt-out-able. §27.7's
 * first word is "optional". Those two are only compatible if the digest and the
 * transactional inventory are disjoint — the moment a receipt, a deadline, or a
 * money decision can appear in a digest, a person who turned the digest off has
 * opted out of something §27.2 says they cannot, and a person who turned it on
 * receives the same fact twice.
 *
 * So the digest does NOT compose from `notification_deliveries`. It composes
 * from the activity records in `DIGEST_ELIGIBLE_ACTIVITY` — the three §27.7
 * names, nothing else — and each entry declares the transactional key that
 * already announces it, so the composer can exclude an item the reader was
 * already emailed about. `coveredBy` is null for the two kinds §27 deliberately
 * gives no transactional message: a campaign update reaches Backers through the
 * digest and nowhere else (§27.5 names the digest and no per-update email), and
 * a comment has no §27 key at all.
 *
 * The suite asserts the disjointness directly: no eligible activity is a money
 * message and none carries a deadline.
 *
 * ── Off is the default, and "never asked" is not "said no" ──────────────────
 * §30 forbids prechecked optional consent, so there is no default frequency
 * anywhere and no code path that sets one without a person choosing it. The
 * absence of a preference row is "has not chosen" — which still sends nothing
 * and is the state that makes §27.7's "selects preference at first magic-link
 * visit" answerable. `off` is a recorded choice, and the difference between the
 * two is whether the product asks again.
 *
 * ── History is a record, not a dashboard ───────────────────────────────────
 * §27.7's own prohibition, and DNA §5.2's. The mechanisms are in the surfaces
 * rather than here — the history has its own route, contributes no Act
 * candidate, and carries no unread count — but the reason is worth stating
 * where the register lives: an unread badge is notification pressure, DNA §5.5
 * replaces pressure with anticipation, and §27.7 names the Founder home as the
 * exact thing this must not become.
 */

/* ── Preference (§27.7, §30) ─────────────────────────────────────────────── */

/** §27.7 names two cadences and no others. */
export const DIGEST_FREQUENCIES = ['daily', 'weekly'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

/** What a person may choose. `off` is a choice; no row at all is not. */
export const DIGEST_PREFERENCES = ['off', ...DIGEST_FREQUENCIES] as const;
export type DigestPreference = (typeof DIGEST_PREFERENCES)[number];

/** The three roles §27.7 gives a preference to. Admin reads history, not digests. */
export const DIGEST_AUDIENCES = ['founder', 'affiliate', 'backer'] as const;
export type DigestAudience = (typeof DIGEST_AUDIENCES)[number];

export function isDigestPreference(value: string): value is DigestPreference {
  return (DIGEST_PREFERENCES as readonly string[]).includes(value);
}

/**
 * §27.2 says transactional email is not opt-out-able and §27.7 makes this one
 * optional. A person turning it off has to be told which of the two they are
 * touching, or the control quietly reads as "stop emailing me" — and the next
 * message they receive is a charge receipt they believe they unsubscribed from.
 * Pinned so the settings surface, the magic-link prompt, and the digest footer
 * all say it in the same words.
 */
export const DIGEST_NEVER_REPLACES_TRANSACTIONAL =
  'This is the only email you can turn off. Messages about your money, your deadlines, and your account always send.';

/** §30: the control ships with nothing chosen, and this is the prompt. */
export const DIGEST_PROMPT_QUESTION = 'Would you like a summary of campaign activity?';

/** The exact option labels, so the three surfaces cannot drift into three vocabularies. */
export const DIGEST_OPTION_LABELS: Record<DigestPreference, string> = {
  off: 'No summary emails',
  daily: 'Once a day',
  weekly: 'Once a week',
};

/* ── Eligible activity (§27.7) ───────────────────────────────────────────── */

export interface EligibleActivity {
  specRef: string;
  /** Which digests may carry this kind. */
  audiences: readonly DigestAudience[];
  /** The record an item is composed from. Never a notification. */
  source: string;
  /**
   * The transactional key that already announces this to the same person, or
   * null where §27 deliberately gives it none. The composer excludes an item
   * whose `coveredBy` key was already delivered — so turning the digest on can
   * add activity, never restate a message (§27.2, §30).
   */
  coveredBy: string | null;
  description: string;
}

/**
 * §27.7's "updates/comments/roster changes", and nothing else. The section says
 * "such as", which is an invitation to add — and §1 rule 6 is why this does not
 * take it. A fourth kind is a decision about what the product emails people
 * about, and the Spec names three.
 */
export const DIGEST_ELIGIBLE_ACTIVITY = {
  campaign_update: {
    specRef: '§27.7, §18',
    // The Founder wrote it, so it is not news to them. §18's audience rule
    // decides which Backers and Creators may see a given update; the composer
    // applies that rule rather than restating it.
    audiences: ['backer', 'affiliate'],
    source: 'campaign_updates',
    // §27.5 names the digest as the delivery mechanism for updates and names no
    // per-update email. This is the one activity kind the digest exists for.
    coveredBy: null,
    description: 'A Founder posted a campaign update',
  },
  campaign_comment: {
    specRef: '§27.7, §18',
    // The Founder of the campaign the thread belongs to. Telling every Backer
    // that another Backer commented is engagement noise with no consequence
    // behind it (§30, and this phase's own "no notification without a real
    // action or consequence").
    audiences: ['founder'],
    source: 'campaign_comments',
    coveredBy: null,
    description: 'Someone commented on your campaign',
  },
  roster_change: {
    specRef: '§27.7, §14.5',
    audiences: ['founder'],
    source: 'association_status_history',
    // §27.3's "roster updates" is a transactional message. A roster change that
    // was emailed is not repeated here; one that was not still summarises.
    coveredBy: 'founder_roster_update',
    description: 'A Creator’s status on your campaign changed',
  },
} as const satisfies Record<string, EligibleActivity>;

export type EligibleActivityKind = keyof typeof DIGEST_ELIGIBLE_ACTIVITY;

export const ELIGIBLE_ACTIVITY_KINDS = Object.keys(
  DIGEST_ELIGIBLE_ACTIVITY,
) as EligibleActivityKind[];

/** The activity kinds a given audience's digest may carry. */
export function activityKindsFor(audience: DigestAudience): EligibleActivityKind[] {
  return ELIGIBLE_ACTIVITY_KINDS.filter((kind) =>
    (DIGEST_ELIGIBLE_ACTIVITY[kind].audiences as readonly string[]).includes(audience),
  );
}

/* ── The period (§27.7) ──────────────────────────────────────────────────── */

/**
 * How far back a digest of this cadence looks. The window is also the dedup
 * entity: one digest per subscriber per period, so a job that runs twice sends
 * once (§27.2).
 */
export const DIGEST_WINDOW_HOURS: Record<DigestFrequency, number> = {
  daily: 24,
  weekly: 24 * 7,
};

/**
 * The period key a moment falls in, used as the `notification_deliveries`
 * entity. Derived from UTC day number so it is stable under a job that runs a
 * few minutes late, and so two workers in the same period compute the same key.
 */
export function digestPeriodKey(frequency: DigestFrequency, at: Date): string {
  const dayNumber = Math.floor(at.getTime() / 86_400_000);
  return frequency === 'daily'
    ? `daily:${dayNumber}`
    : `weekly:${Math.floor(dayNumber / 7)}`;
}

/**
 * The window a digest sent at `at` covers. Closed at `at`, open at the start —
 * an item exactly on the boundary belongs to the earlier window, so no item is
 * counted twice across two runs.
 */
export function digestWindow(frequency: DigestFrequency, at: Date): { from: Date; to: Date } {
  return {
    from: new Date(at.getTime() - DIGEST_WINDOW_HOURS[frequency] * 3_600_000),
    to: at,
  };
}

/* ── What the digest is not (§30, §33.6.11) ──────────────────────────────── */

/**
 * §30 and this phase's scope item 6. A digest is the shape a check-in email
 * most easily hides inside, so the things it must never do are stated as data
 * the suite reads rather than as a comment nobody runs.
 *
 * An empty digest is the important one: a summary of nothing is a scheduled
 * generic message with a subject line, which is exactly what §33.6.11 forbids.
 */
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

export type DigestProhibition = keyof typeof DIGEST_PROHIBITIONS;

/**
 * Phrases that turn a summary into a nudge. Scanned across the digest templates
 * and payloads by the coverage suite, on the model of `BANNED_FRESHNESS_TERMS`
 * in §20's live register — the wording is what leaks, so the wording is what is
 * checked.
 */
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

/* ── History (§27.7) ─────────────────────────────────────────────────────── */

/** §27.7 names three authenticated surfaces. The Backer has no account (§5). */
export const HISTORY_AUDIENCES = ['founder', 'affiliate', 'admin'] as const;
export type HistoryAudience = (typeof HISTORY_AUDIENCES)[number];

/**
 * `notification_deliveries` stores no subject and no body, and this is where
 * that becomes a design statement rather than an omission: the history says
 * which message was sent, when, about what, and whether the provider confirmed
 * it. Storing rendered bodies would put a second copy of every personal fact
 * we have ever emailed into a table §25.8 would then have to sweep, to show a
 * person text they already hold in their inbox.
 */
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
