/**
 * §26.8's editable response templates.
 *
 * "Support responses start from editable templates and preserve all context so
 * users are never asked to repeat already-known campaign/reservation/charge
 * facts."
 *
 * Two words in that sentence decide the design:
 *
 * **editable** — a template is a *starting point* an Admin rewrites, never a
 * canned response that sends itself. There is no route that sends a template
 * directly, and `addCaseMessage` takes a body the Admin actually composed with a
 * `templateKey` recording where it started. A one-click send would be §1.4's
 * failure in the place it matters most: a customer would be answered by a
 * machine presented as a person.
 *
 * **preserve all context** — the facts are substituted from the case's own
 * records, so an Admin never retypes an amount and a customer is never asked
 * "which pre-order was this?". A wrong amount typed into a support reply is how
 * support comes to contradict the ledger, which is the failure §26.6's preview
 * requirement guards against on the money side.
 *
 * ── No provider code reaches a template ─────────────────────────────────────
 * §33.9.11 is enforced in `addCaseMessage`, but a template that *shipped* with a
 * decline code in it would put an Admin one keystroke from a violation. So the
 * templates deal only in facts a customer already has: their reward, their
 * amounts, their descriptor, their dates. A failed payment is described by what
 * it means, never by what the provider called it.
 */

import type { CaseContext } from './cases.js';

export interface ResponseTemplate {
  readonly key: string;
  readonly label: string;
  readonly specRef: string;
  /** When an Admin would reach for it. */
  readonly useWhen: string;
  /** Rendered with the case's own facts. The Admin edits what comes back. */
  render: (context: CaseContext) => string;
}

const usd = (cents: string | null): string => {
  if (cents === null) return 'the amount on your pre-order';
  const n = BigInt(cents);
  const dollars = n / 100n;
  const rest = (n % 100n).toString().padStart(2, '0');
  return `US$${dollars.toLocaleString('en-US')}.${rest}`;
};

const campaignName = (context: CaseContext): string =>
  context.campaign?.title ?? 'the campaign you pre-ordered from';

/**
 * The templates, one per situation the Spec actually names.
 *
 * Deliberately few. §26.8 asks for editable starting points, not a content
 * library — and a long list encourages picking the nearest match rather than
 * writing the true answer.
 */
export const RESPONSE_TEMPLATES: readonly ResponseTemplate[] = [
  {
    key: 'unknown_charge',
    label: 'A charge they do not recognise',
    specRef: '§29.9',
    useWhen:
      'Before a dispute. §29.9: identify the Founder and campaign, send the receipt and context, and route to refund or product support.',
    render: (c) =>
      [
        `Thanks for flagging this — case ${c.reference}.`,
        '',
        c.reservation
          ? `That charge relates to your pre-order on ${campaignName(c)}: ${
              c.reservation.rewardTitle ?? 'your selected reward'
            }, ${usd(c.reservation.subtotalCents)} plus ${usd(
              c.reservation.taxCents,
            )} sales tax, ${usd(c.reservation.totalAuthorizedCents)} in total.`
          : `That charge relates to your pre-order on ${campaignName(c)}.`,
        c.reservation?.statementDescriptor
          ? `On your statement it appears as ${c.reservation.statementDescriptor}.`
          : '',
        c.reservation?.reservedAt
          ? `You saved your card on ${c.reservation.reservedAt.slice(0, 10)}.`
          : '',
        '',
        '[Say what happens next, and by when.]',
      ]
        .filter(Boolean)
        .join('\n'),
  },
  {
    key: 'cancellation_confirmed',
    label: 'Confirming a cancellation',
    specRef: '§20',
    useWhen: 'They asked to cancel and it is done. Lead with the fact that nothing was charged.',
    render: (c) =>
      [
        `Case ${c.reference}.`,
        '',
        `Your pre-order on ${campaignName(c)} is canceled and you were not charged.`,
        c.reservation
          ? `Nothing was taken for ${c.reservation.rewardTitle ?? 'your selected reward'} — the authorized total of ${usd(
              c.reservation.totalAuthorizedCents,
            )} was never collected.`
          : '',
        '',
        '[Say whether they can pre-order again, if the campaign is still open.]',
      ]
        .filter(Boolean)
        .join('\n'),
  },
  {
    key: 'delivery_question',
    label: 'A delivery question',
    specRef: '§22.5, §22.6',
    useWhen: 'They are asking when the reward arrives. Never promise a date the Founder has not.',
    render: (c) =>
      [
        `Case ${c.reference}.`,
        '',
        c.reservation
          ? `You pre-ordered ${c.reservation.rewardTitle ?? 'a reward'} on ${campaignName(c)}.`
          : `About your pre-order on ${campaignName(c)}.`,
        '',
        '[State the delivery commitment exactly as it appears on the campaign. Do not estimate.]',
        '[If the date has moved, say so plainly and say what the Founder has committed to now.]',
      ]
        .filter(Boolean)
        .join('\n'),
  },
  {
    key: 'payment_did_not_go_through',
    label: 'A payment that did not go through',
    specRef: '§21, §33.9.11',
    useWhen:
      'Their card was declined. Describe what it means for them — never paste the provider or fraud code.',
    render: (c) =>
      [
        `Case ${c.reference}.`,
        '',
        `We were not able to complete the charge for your pre-order on ${campaignName(c)}, so nothing has been taken.`,
        c.reservation
          ? `The amount involved was ${usd(c.reservation.totalAuthorizedCents)}.`
          : '',
        '',
        '[Say what they can do — update the card through their pre-order link — and by when.]',
        '',
        'Note for the responder: the provider decline detail stays in the internal notes on this case. It must not appear in this message (§33.9.11).',
      ]
        .filter(Boolean)
        .join('\n'),
  },
  {
    key: 'reward_not_as_described',
    label: 'The reward is not as described',
    specRef: '§29.10',
    useWhen:
      '§29.10: the Backer contacts the Founder first; after 14 days with no response or resolution they may escalate to Proovd.',
    render: (c) =>
      [
        `Case ${c.reference}.`,
        '',
        `Thanks for telling us about the problem with ${
          c.reservation?.rewardTitle ?? 'your reward'
        } from ${campaignName(c)}.`,
        '',
        '[Confirm whether they have raised it with the Founder, and when.]',
        '[If it has been more than 14 days with no response or no resolution, say that Proovd will now mediate and by when.]',
        '',
        'Your rights with your card issuer are unaffected by anything here.',
      ]
        .filter(Boolean)
        .join('\n'),
  },
  {
    key: 'holding_update',
    label: 'An update at the promised checkpoint',
    specRef: '§27.8',
    useWhen:
      '§27.8: "Even without resolution, send an update at the promised checkpoint." This is that message.',
    render: (c) =>
      [
        `Case ${c.reference}.`,
        '',
        'We said we would come back to you today, so here is where this stands.',
        '',
        '[Say what has actually happened since you last wrote — not that it is "being looked into".]',
        '[Say who owns it now and what the next step is.]',
        '[Give the next checkpoint date. Then set it on the case so it appears in the queue.]',
      ].join('\n'),
  },
];

export function findTemplate(key: string): ResponseTemplate | undefined {
  return RESPONSE_TEMPLATES.find((t) => t.key === key);
}

/**
 * Render a template against a case.
 *
 * Returns the draft *and* the context that filled it, so the Admin surface can
 * show which facts came from the record — the difference between a template a
 * person edits knowingly and one they send without reading.
 */
export function renderTemplate(
  key: string,
  context: CaseContext,
): { key: string; label: string; draft: string; preservedFacts: Record<string, string> } | null {
  const template = findTemplate(key);
  if (!template) return null;

  const preservedFacts: Record<string, string> = {
    caseReference: context.reference,
    topic: context.topic,
    owner: context.owner,
    humanResponseDue: context.humanResponseDueAt,
  };
  if (context.campaign) {
    preservedFacts['campaign'] = context.campaign.title ?? context.campaign.id;
    preservedFacts['campaignStatus'] = context.campaign.status;
  }
  if (context.reservation) {
    preservedFacts['reward'] = context.reservation.rewardTitle ?? '—';
    preservedFacts['subtotal'] = usd(context.reservation.subtotalCents);
    preservedFacts['salesTax'] = usd(context.reservation.taxCents);
    preservedFacts['totalAuthorized'] = usd(context.reservation.totalAuthorizedCents);
    preservedFacts['reservationStatus'] = context.reservation.status;
    if (context.reservation.statementDescriptor) {
      preservedFacts['statementDescriptor'] = context.reservation.statementDescriptor;
    }
  }

  return {
    key: template.key,
    label: template.label,
    draft: template.render(context),
    preservedFacts,
  };
}
