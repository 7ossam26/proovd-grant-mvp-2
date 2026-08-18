/**
 * The Founder onboarding flow's pages — Founder Flow v2, Session B, 2026-08-18.
 *
 * ── Why this is a register and not a router ─────────────────────────────────
 * The reference is twenty-six full-bleed pages, each owning its viewport, with
 * no persistent chrome. Three things need to agree about what those pages ARE:
 * the router, the help drawer (which lists one card per page, marks the current
 * one, and jumps), and §33.11's flow register. Three hand-written lists is two
 * chances to disagree, and the disagreement shows up as a help card that jumps
 * somewhere that does not exist.
 *
 * ── It holds only the pages that EXIST ──────────────────────────────────────
 * Twenty-six are planned and four are built. Declaring the other twenty-two
 * would be `events.ts`'s failure in a different file — a register entry
 * claiming a surface the product does not have (§1.4). Sessions C through F
 * append to this list as they build; the help drawer's "everything before it"
 * is therefore always true rather than aspirational.
 *
 * ── The order is the reconciliation's, not the reference's ──────────────────
 * `docs/phases/founder-flow-reconciliation.md` §1 is the canonical order, and
 * it differs from the reference's own in three places, each forced by code that
 * already exists rather than by an opinion. `stage` is the auth regime a page
 * sits under, and it is the reason those three moves are not negotiable: a page
 * cannot be one stage earlier than the mechanism that authorises it.
 */

/**
 * The five auth regimes of the flow, from `founder-flow-reconciliation.md` §1.
 *
 * 1 — the draft token (`requireDraftToken`). No account exists.
 * 2 — the claim itself. `completeClaim`, once.
 * 3 — a Founder session (`requireRole('founder')`).
 * 4 — a Founder session, money. A complete `founder_seller` account.
 * 5 — post-fee. Phase 11's effect 4 has opened the formal Creator opportunity.
 */
export type FounderFlowStage = 1 | 2 | 3 | 4 | 5;

export interface FounderFlowPage {
  /** Stable id. The help drawer, the router, and the tests all key on it. */
  id: string;
  /**
   * The route pattern. `:token` is the router's own param and is substituted
   * by `founderFlowPath` — never interpolated by hand at a call site, because
   * a raw token in a hand-built string is one edit away from a query parameter
   * a Referer would carry to a third party (§28.1).
   */
  path: string;
  /** The help drawer's card title. */
  title: string;
  /** The help drawer's one-line explanation. One line, and it stops. */
  help: string;
  stage: FounderFlowStage;
}

export const FOUNDER_FLOW_PAGES: readonly FounderFlowPage[] = [
  {
    id: 'invite',
    path: '/draft/:token',
    title: 'Your invite',
    help: 'We filled in most of this from our call. Read it, change anything that is off, and open the form.',
    stage: 1,
  },
  {
    id: 'problem',
    path: '/draft/:token/problem',
    title: 'Your problem',
    help: 'The problem we heard you describe. A reviewer and a Creator both read it, so plain words beat polished ones.',
    stage: 1,
  },
  {
    id: 'solution',
    path: '/draft/:token/solution',
    title: 'Your solution',
    help: 'What you are building, in your words. One or two sentences beats a paragraph.',
    stage: 1,
  },
  {
    id: 'campaign-type',
    path: '/draft/:token/campaign-type',
    title: 'Campaign type',
    help: 'An Idea Campaign tests demand before you build. A Product Campaign pre-sells something that already exists. The choice locks when you submit the form.',
    stage: 1,
  },
  {
    id: 'email',
    path: '/draft/:token/email',
    title: 'Your email',
    help: 'Where we send everything about this campaign. It is filled in from your invitation — change it if that is not the address you want.',
    stage: 1,
  },
  {
    id: 'code',
    path: '/draft/:token/code',
    title: 'Confirm your email',
    help: 'Six digits, sent to that address. It only confirms we can reach you — it creates no account and signs you into nothing.',
    stage: 1,
  },
  {
    id: 'positioning',
    path: '/draft/:token/positioning',
    title: 'Your positioning',
    help: 'The one answer we never draft for you. Who else solves this, and why someone would choose you. Finishing it submits your answers.',
    stage: 1,
  },
  {
    id: 'match',
    path: '/draft/:token/match',
    title: 'Creators who may fit',
    help: 'How many Creators in your category might be a fit for what you just described. It is a relevance signal, not a roster, and nobody has agreed to anything.',
    stage: 1,
  },
];

export type FounderFlowPageId = (typeof FOUNDER_FLOW_PAGES)[number]['id'];

/** Every page's route pattern, for the §33.11 flow register and its fixtures. */
export const FOUNDER_FLOW_ROUTES: readonly string[] = FOUNDER_FLOW_PAGES.map(
  (page) => page.path,
);

export function founderFlowPage(id: string): FounderFlowPage | undefined {
  return FOUNDER_FLOW_PAGES.find((page) => page.id === id);
}

export function founderFlowIndex(id: string): number {
  return FOUNDER_FLOW_PAGES.findIndex((page) => page.id === id);
}

/**
 * A page's real address for one draft.
 *
 * The token is encoded here, once. Every caller passes the raw value and gets
 * a path back; nothing builds one by hand.
 */
export function founderFlowPath(id: string, token: string): string {
  const page = founderFlowPage(id);
  if (!page) throw new Error(`unknown founder flow page: ${id}`);
  return page.path.replace(':token', encodeURIComponent(token));
}

/* ── The help drawer ──────────────────────────────────────────────────────── */

/**
 * §27.1's sixth question — *how do I get help without losing context* —
 * answered for the whole flow rather than per screen.
 *
 * The subhead is load-bearing and is the reference's own: the drawer lists the
 * current page and the ones already passed, and NOT the ones ahead. A drawer
 * that listed what is coming would be a progress bar with reading attached,
 * and it would name pages the Founder cannot reach yet.
 */
export const FOUNDER_FLOW_HELP_TITLE = 'Help';
export const FOUNDER_FLOW_HELP_SUBHEAD = 'This page and everything before it';

/* ── What the reference draws and the Spec forbids ────────────────────────── */

export interface FounderFlowAbsence {
  /** The reference's own element, named so it is recognisable in the bundle. */
  element: string;
  /** Why it is not here. Read by a person deciding whether to add it back. */
  absentBecause: string;
  specRef: string;
}

/**
 * The Founders-rebuild `OPERATIONS_ABSENCES` arrangement, applied to a flow.
 *
 * These are elements the reference draws that no surface renders. Unlike an
 * absence a screen can explain in a sentence, each of these is the removal of a
 * whole element, so there is nowhere on a page to say why — which is exactly
 * why it is written down here instead. A later session that wants one back has
 * to delete the entry that refuses it.
 */
export const FOUNDER_FLOW_ABSENCES: readonly FounderFlowAbsence[] = [
  {
    element:
      'The reach screen — a full page of orbiting phones behind "We can get [product] in front of [N] new people", between Solution and campaign type',
    absentBecause:
      'It promises a result. §7 forbids Admin promising acceptance, results, reward pricing, or a named Creator\'s participation, and no record holds an audience number — the prototype\'s own is the constant 10,000. §10\'s relevance signal is the honest version of this beat: it counts Creators who might be a fit, carries six sentences saying what the number is not, and names nobody.',
    specRef: '§7, §10, §1 rule 6',
  },
  {
    element:
      'The same "in front of [N] new people" line on the invite page, above the claim button',
    absentBecause:
      'The same promise in a smaller typeface. The invite page states what was done and what happens next, and offers no number nobody recorded.',
    specRef: '§7, §1 rule 6',
  },
  {
    element:
      'The message badge shaking on a loop — five rotations every six seconds, for as long as the page is open',
    absentBecause:
      'An element that moves indefinitely to draw attention is the pattern, whatever it opens. The badge stays, it enters once with the page, and then it is still.',
    specRef: 'DNA §5.10, §30',
  },
  {
    element: 'The campaign type rendered as `prebuild` / `prelaunch`',
    absentBecause:
      'Those are internal values and never reach a Founder. `CAMPAIGN_PATH_CHOICES[].name` — Idea Campaign, Product Campaign — is the only thing that renders.',
    specRef: '§3.1',
  },
  {
    element:
      'The match screen’s sub-line, `In your category are ready to promote this`',
    absentBecause:
      '§10 forbids exactly this claim: the number "guarantees neither that anyone will take part nor what results they would produce" and "is not the recruited/accepted roster". "Ready to promote this" says people who have agreed to nothing are ready to promote something. `POSSIBLE_CREATOR_RESULT_DISCLOSURES` is the honest version of the same beat, and it is six sentences long because every one of them is a limit the number needs.',
    specRef: '§10, §30',
  },
  {
    element:
      'The match screen’s breakdown — `1 Newsletter / blog operator`, `2 Community owners`',
    absentBecause:
      '`possible_creator_results` holds a count, a basis, and who recorded it. There is no category breakdown to render, so drawing one would mean inventing a fact (§1 rule 6) about people the Founder may not be shown — and §11’s boundary is why: describing them by kind is a step from "names no Creator" toward a roster. The `basis` never leaves Admin.',
    specRef: '§10, §11, §1 rule 6',
  },
  {
    element: 'The email screen’s headline, `To save your progress verify your email:`',
    absentBecause:
      'Progress is already saved. §9’s autosave writes every answer through the draft token, and the link in the invitation is what brings a Founder back to it — verifying an address changes none of that. A sentence naming the wrong mechanism is the §1.4 failure in one line, and it is the line somebody reads while deciding whether they can close the tab.',
    specRef: '§1.4, §9',
  },
  {
    element:
      'The email field’s ink turning `#A2AFA8` while the field has focus, returning to `#013F17` on blur',
    absentBecause:
      'That is `--grey` on `--white`, about 2.2:1, applied to the text a person is actively typing. It is the token for placeholders and disabled ink, and Session B moved five sentences off it for the same reason. The dashed brand underline is what marks focus here; the ink stays legible.',
    specRef: '§28.5, §33.11',
  },
];

/* ── The two sentences the shell itself pins ────────────────────── */

/**
 * The invite page's own statement of what the button does.
 *
 * §7's invitation must explain "what will happen before an account or payment
 * is required", and the strongest form of that is a sentence saying the door is
 * a door. It sits with the control rather than in the small print, because
 * somebody who reads only the button needs it more than somebody who reads the
 * whole page.
 */
export const FLOW_NOTHING_COMMITTED =
  'Opening the form creates no account and asks for no card. You can close it at any point and come back to this same link — everything you have written is still here.';

/**
 * Rendered wherever the flow shows what was drafted for the Founder.
 *
 * §9 stores the supplier of the current value, and showing it is what makes
 * "we drafted this, you can change it" honest rather than a surprise.
 */
export const FLOW_PREFILL_NOTE =
  'We wrote this from our conversation. Change anything that is not right — it is your product.';
