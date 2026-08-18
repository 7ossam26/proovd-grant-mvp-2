/**
 * The flow's eight answers, as a sequence — Founder Flow v2, Session D.
 *
 * ── This is a presentation over two registers, and they stay two ────────────
 * The reference calls screens 7–14 "the eight vetting answers" and treats them
 * as one list. They are not one list, and the brief says so in as many words:
 * answers 1–3 are §9's `campaign_vetting`, answers 4–8 are §12's
 * `campaign_optional_items`, "and they stay two". The difference is not
 * cosmetic. A §9 answer is text the Founder wrote and Proovd stores; a §12
 * answer is COMPLETE or not, decided server-side from objective evidence, and
 * worth US$2 off the listing fee when it is. Merging them into one `answers`
 * table — or one register with a `complete` field on every row — would quietly
 * make §12 completion a Founder assertion, which is the one thing §12 is built
 * to prevent.
 *
 * So this file holds no copy, no completion rule, and no discount. It holds the
 * ORDER, and for each entry which register owns it and which page renders it.
 * `VETTING_STEPS` and `OPTIONAL_ITEMS` are still the only places the words live,
 * and the drift test asserts every key here exists in exactly one of them.
 *
 * ── Why the order is a register at all ──────────────────────────────────────
 * Last look renders all eight and has to know which are which — the first three
 * are locked at submission (§9) and offer no edit, the last five open. Deriving
 * "the first three" from an array index would work until somebody reorders it.
 * `owner` is the fact; the position is just the position.
 */

import { OPTIONAL_ITEMS, type OptionalItemKey } from '../workspace/index.js';
import { VETTING_STEPS, type VettingStepId } from './steps.js';

export type FounderAnswerOwner = 'vetting' | 'optional';

export interface FounderAnswerEntry {
  /**
   * The key in its OWN register — a `VettingStepId` or an `OptionalItemKey`.
   * Deliberately not a new namespace: a third set of ids over the same eight
   * things is a third thing to keep in step.
   */
  key: VettingStepId | OptionalItemKey;
  owner: FounderAnswerOwner;
  /** The `FOUNDER_FLOW_PAGES` id that renders it. */
  pageId: string;
  /**
   * Whether Last look can offer to change it.
   *
   * False for every §9 answer, and the reason is a mechanism rather than a
   * policy: §9's route is behind the draft token, and §10's claim invalidates
   * it. There is no address left to send somebody to.
   */
  editableAfterClaim: boolean;
}

export const FOUNDER_ANSWER_SEQUENCE: readonly FounderAnswerEntry[] = [
  { key: 'problem', owner: 'vetting', pageId: 'problem', editableAfterClaim: false },
  { key: 'solution', owner: 'vetting', pageId: 'solution', editableAfterClaim: false },
  { key: 'competition', owner: 'vetting', pageId: 'positioning', editableAfterClaim: false },
  { key: 'visuals', owner: 'optional', pageId: 'visuals', editableAfterClaim: true },
  { key: 'branding', owner: 'optional', pageId: 'branding', editableAfterClaim: true },
  { key: 'interview', owner: 'optional', pageId: 'interview', editableAfterClaim: true },
  { key: 'story', owner: 'optional', pageId: 'story', editableAfterClaim: true },
  { key: 'socials', owner: 'optional', pageId: 'socials', editableAfterClaim: true },
];

/** The five optional answers, in flow order — the stage-3 sequence itself. */
export const FOUNDER_OPTIONAL_SEQUENCE: readonly FounderAnswerEntry[] =
  FOUNDER_ANSWER_SEQUENCE.filter((entry) => entry.owner === 'optional');

/**
 * The title Last look and each answer page show for one entry.
 *
 * Read from whichever register owns it, so there is one copy of each label. A
 * second `title` field here would be a second answer to what an answer is
 * called, and the one nobody updates is the one that ships.
 */
export function founderAnswerLabel(entry: FounderAnswerEntry): string {
  if (entry.owner === 'vetting') {
    return VETTING_STEPS.find((step) => step.id === entry.key)?.label ?? entry.key;
  }
  return OPTIONAL_ITEMS.find((item) => item.key === entry.key)?.label ?? entry.key;
}

/** The page after this one, or `null` at the end of the optional sequence. */
export function founderAnswerNext(pageId: string): FounderAnswerEntry | null {
  const index = FOUNDER_OPTIONAL_SEQUENCE.findIndex((entry) => entry.pageId === pageId);
  if (index < 0) return null;
  return FOUNDER_OPTIONAL_SEQUENCE[index + 1] ?? null;
}

/** The page before this one, or `null` at the start of the optional sequence. */
export function founderAnswerPrevious(pageId: string): FounderAnswerEntry | null {
  const index = FOUNDER_OPTIONAL_SEQUENCE.findIndex((entry) => entry.pageId === pageId);
  if (index <= 0) return null;
  return FOUNDER_OPTIONAL_SEQUENCE[index - 1] ?? null;
}
