/**
 * The backend's copy of what Session F's PAYLOADS carry.
 *
 * The backend never imports `@proovd/shared` at runtime: shared exports
 * TypeScript source, this package compiles under `rootDir: src`, and the
 * production image ships only `backend/dist`. So the export register, the
 * withheld list, the do-not-fulfill sentence and §25.7's two permitted purposes
 * are restated here and drift-tested against shared — the arrangement the §14.5
 * roster labels, the §21 close registers and the §27.2 contract rules all use.
 *
 * Only what the server composes is restated. `WRAP_ABSENCES`, the refused
 * purposes' reasons and the pinned copy the Chapter renders reach the browser
 * through Vite; a second copy of those would be a second copy of an argument.
 *
 * The export register is here rather than surface-side deliberately: §25.7's
 * limit applies to what leaves the server, and a column list the browser owned
 * would be a limit the requester can widen.
 */

export interface FounderExportColumn {
  readonly key: string;
  readonly header: string;
  readonly definition: string;
}

/** §20 Explore 10 + §25.7. `Pre-order`, never `Pledge` (§3.2). */
export const FOUNDER_EXPORT_COLUMNS = [
  {
    key: 'preorderReference',
    header: 'Pre-order',
    definition: 'The pre-order this row is about. Quote it when you contact support.',
  },
  {
    key: 'backerEmail',
    header: 'Backer email',
    definition:
      '§19 shares this with you for fulfillment and support. It is not a marketing list (§25.7).',
  },
  {
    key: 'rewardSku',
    header: 'Reward SKU',
    definition: 'The reward they chose, as it appears on your build.',
  },
  {
    key: 'rewardTitle',
    header: 'Reward',
    definition: 'The reward title the Backer saw at checkout.',
  },
  {
    key: 'fulfillmentState',
    header: 'Fulfillment',
    definition: 'Whether you owe this person a reward right now, or must not send one.',
  },
  {
    key: 'progressionStep',
    header: 'Where they are',
    definition: '§31.8: the step this pre-order has actually reached. Never a predicted one.',
  },
  {
    key: 'sharedAt',
    header: 'Shared with you',
    definition: 'When §19 shared this pre-order with you. Stored in UTC.',
  },
] as const satisfies readonly FounderExportColumn[];

export interface FounderExportWithheld {
  readonly header: string;
  readonly reason: string;
}

export const FOUNDER_EXPORT_WITHHELD = [
  {
    header: 'Checkout comment / survey answers',
    reason:
      '§25.7: identifiable survey answers need the specific optional consent from §19 step 7, and an export cannot carry that condition with it. They appear on Explore, where each answer sits beside the consent that permits it.',
  },
  {
    header: 'Backer name',
    reason:
      '§19 shares the email and the purchase details fulfillment needs. No name is collected at checkout, so there is none to share.',
  },
  {
    header: 'Billing address, phone, card details',
    reason:
      '§25.7 restricts these to Admin. Proovd never holds a card number at all (§32.4), and a delivery address is the Founder’s own to ask for.',
  },
  {
    header: 'Attribution source',
    reason:
      '§18 records which tracking link a pre-order came through. It belongs to the Creator’s compensation record, and per-Backer attribution is not a fulfillment fact.',
  },
] as const satisfies readonly FounderExportWithheld[];

/** §19: a share that was withdrawn renders as what it is. */
export const DO_NOT_FULFILL_LABEL = 'canceled / no charge — do not fulfill';

/** §25.7's two permitted purposes, also CHECK-pinned in 0058. */
export const BACKER_DATA_PURPOSE_KEYS = ['fulfillment', 'support'] as const;
export type BackerDataPurposeKey = (typeof BACKER_DATA_PURPOSE_KEYS)[number];

export function isBackerDataPurpose(value: unknown): value is BackerDataPurposeKey {
  return typeof value === 'string' && (BACKER_DATA_PURPOSE_KEYS as readonly string[]).includes(value);
}

export const BACKER_DATA_REQUEST_DECISIONS = ['approved', 'declined'] as const;
export type BackerDataRequestDecision = (typeof BACKER_DATA_REQUEST_DECISIONS)[number];

export function isBackerDataDecision(value: unknown): value is BackerDataRequestDecision {
  return (
    typeof value === 'string' &&
    (BACKER_DATA_REQUEST_DECISIONS as readonly string[]).includes(value)
  );
}
