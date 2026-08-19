/**
 * Chapter 2, Live — Founder Dashboard Session D.
 *
 * `docs/phases/founder-dashboard.md`. What the Founder does between launch and
 * close: read §20's Glance, do the one ranked Act, explore everything else,
 * change the parts of the page they are allowed to change, post updates, and
 * acknowledge a Creator's post.
 *
 * ── The chapter is a READER with three narrow write paths ──────────────────
 * §20 gives a live campaign three altitudes and exactly one set of edits. Every
 * number here is composed by `readCampaignHome`; nothing on this surface adds
 * one up. The three things a Founder may WRITE are the §20 live edit (one
 * route, and the field's tier decides what it does), the §18 update, and
 * deviation 2's acknowledgement.
 *
 * ── The numbers are permitted; the ranking is not ──────────────────────────
 * §30 defers "Public leaderboards/shaming" and the Creator close view already
 * ships with no rank on that basis. §20's Explore section 5 is `creator_results`
 * and a Founder is entitled to it. The distinction the reference gets wrong is
 * that a ranking is not one control — it is four: an `h1` naming a winner,
 * numbered badges, a podium with a `Top` tag, and the list being SORTED by a
 * metric. Removing the crown and keeping the sort is still a ranking, so the
 * server states its order (`explore.ts` orders by public handle) and this
 * surface renders no position, no medal, and no per-Creator comparison.
 *
 * ── Nothing has been charged, and the Glance says so permanently ───────────
 * §20 requires "Permanent clarification that these people selected an offer and
 * agreed to charge rules but have not yet been charged", and §30 forbids
 * anything that confuses a saved card with a charge. The reference's hero is
 * `$12,840 Money made`, which is false during a live campaign — capture is
 * §21's close batch and nothing has moved. The hero here is §20's own: the
 * active pre-order count.
 */

import type { EditTier } from '../live/editing.js';

/* ── §20's three live-editing tiers, as a Founder reads them ─────────────── */

export interface EditTierGroup {
  readonly tier: EditTier;
  /** Customer-facing (§3.1) — what this column DOES, not what it is called. */
  readonly label: string;
  /** One sentence, rendered above the fields in this column. */
  readonly explainer: string;
  readonly specRef: string;
}

/**
 * The register decides which column a field is in; this only names the columns.
 *
 * The Founder never classifies their own edit (§15 makes materiality an Admin
 * judgement recorded with its reason), so the surface never sends a tier and
 * there is no control that could choose one. It sends the field and the value,
 * and `applyLiveEdit` looks the field up. That is what makes §33.6.12's
 * "material edits cannot publish directly" a structural fact rather than a
 * promise about behaviour.
 */
export const EDIT_TIER_GROUPS: readonly EditTierGroup[] = [
  {
    tier: 'direct_versioned',
    label: 'Changes right away',
    explainer:
      'Typos, clarifications, and notes about your brand. These go live as soon as you save, and every version is kept.',
    specRef: '§20',
  },
  {
    tier: 'requires_review',
    label: 'Goes to Proovd first',
    explainer:
      'Anything that changes what you promised — a claim, a price, a date, a delivery window, a refund term. Proovd reviews it, and any Creator whose terms it affects has to accept it before it appears.',
    specRef: '§20, §15',
  },
  {
    tier: 'never_direct',
    label: 'Locked while your campaign is running',
    explainer:
      'These were fixed when people agreed to them. Changing one now would change a deal somebody already accepted, so there is nothing here to edit.',
    specRef: '§20',
  },
];

export function editTierGroup(tier: EditTier): EditTierGroup {
  const found = EDIT_TIER_GROUPS.find((g) => g.tier === tier);
  if (!found) throw new Error(`no edit tier group '${tier}'`);
  return found;
}

/**
 * §20 names the FAQ loophole by example and `commitmentsIn` closes it for every
 * column-one free-text field. A Founder whose typo fix is routed to review needs
 * telling why, or the routing reads as the product being broken.
 */
export const COMMITMENT_ROUTES_TO_REVIEW =
  'That text states a date, a price, a refund, or a delivery promise. A promise is reviewed wherever it is written, so this went to Proovd rather than straight onto your page.';

/**
 * §15's materiality is an Admin judgement recorded with its reason, and 12b's
 * `recordMaterialChange` was built to take a classification rather than guess
 * one. The Founder does not get to say what kind of change theirs is.
 */
export const TIER_IS_A_PROPERTY_OF_THE_FIELD =
  'Which of these three a change falls into depends on what you are changing, not on how big it feels. You pick the thing; Proovd decides the path.';

/* ── The Glance, and the sentence the reference leaves out ───────────────── */

/**
 * §20 lists the permanent clarification among Glance's own bullets, and §30's
 * first prohibition is anything that confuses a saved card with a charge. The
 * reference's hub hero is `$12,840 Money made` with no such line anywhere.
 *
 * `readGlance` composes the customer-facing sentence; this is the sentence that
 * rides the reserved totals, where a money figure is unavoidable.
 */
export const RESERVED_IS_NOT_RAISED =
  'None of this has been charged. These are the totals Backers authorized — the charge happens when your campaign closes.';

/**
 * §20: "Data freshness such as `Updated 3:40 PM`; never say real time." §30 bans
 * the immediacy claim outright. The reference's figures carry `+18 since you
 * left` with no read time at all.
 */
export const FRESHNESS_IS_A_READ_TIME =
  'This page reads your record when you load it. Nothing here updates while you watch it.';

/* ── Deviation 2: the post acknowledgement ───────────────────────────────── */

/**
 * A RECORDED DEVIATION from §1 rule 6, by explicit product direction.
 *
 * The reference's toast reads "Liked — creator will see it", which makes it a
 * message rather than a private bookmark. §30 defers direct Founder–Affiliate
 * messaging and §11 says the Founder cannot contact the Affiliate directly, so
 * the brief's treatment is §22.9's again: a recorded acknowledgement with its
 * own §27 key, deduped on the post, and **no free text**.
 *
 * The free text is the whole of the narrowing. A note box here is the direct
 * messaging §30 defers wearing a smaller control, and the record has no column
 * it could be written to.
 */
export const ACKNOWLEDGEMENT_HAS_NO_MESSAGE =
  'This tells them you saw it and nothing else. There is no note to write — anything you want to say goes through Proovd.';

/**
 * The reference toggles: `Like it` ⇄ `Liked ✓`, with a "Like removed." toast.
 *
 * A toggle is wrong here because a message went out. Un-acknowledging would
 * leave the record saying one thing and the Creator's inbox saying another, and
 * §27.2's dedup means a re-acknowledgement sends nothing — so the second half of
 * the toggle is a control that quietly does less than it says. It is one-way,
 * the table has no DELETE grant, and the surface offers no undo.
 */
export const ACKNOWLEDGEMENT_IS_ONE_WAY =
  'Once you send it, they have it. There is no way to take it back, so it is worth meaning it.';

/**
 * §17's verification is Admin's, and a `correction_needed` or `rejected` post is
 * one Proovd has found a problem with. Acknowledging it would tell the Creator
 * their Founder liked work Proovd has just asked them to change or enforced
 * against — two messages about the same post saying opposite things.
 *
 * This narrows a deviation rather than adding a condition to existing
 * machinery: nothing about §17's own outcomes changes.
 */
export const ACKNOWLEDGEMENT_NOT_WHILE_UNDER_CORRECTION =
  'Proovd has asked for a change to this post. It is not one to send a note about until that is settled.';

/* ── What the reference draws that this chapter does not ─────────────────── */

export interface LiveAbsence {
  /** A stable id, so a test can walk the register against the rendered chapter. */
  readonly id: string;
  /** What the reference puts here. */
  readonly reference: string;
  /** The sentence the chapter renders where the control would have been. */
  readonly sentence: string;
  readonly specRef: string;
}

/**
 * `CHOOSE_ABSENCES`' arrangement, applied to Chapter 2. Every control the
 * reference draws that the Spec forbids, carrying the sentence the surface
 * renders in its place — so re-adding one means deleting the sentence that
 * refuses it, which is a visible edit rather than a quiet one.
 */
export const LIVE_ABSENCES: readonly LiveAbsence[] = [
  {
    id: 'creator_leaderboard',
    reference:
      '“Farah Nassar is leading.” as an h1, #1–#6 badges, a three-place podium with a “Top” tag, and “See the full leaderboard”.',
    sentence:
      'Your Creators are listed in a fixed order that has nothing to do with how they are doing. Proovd does not rank them against each other, and nobody here is told they are behind.',
    specRef: '§30, §20',
  },
  {
    id: 'money_made',
    reference: '“$12,840 Money made” as a hero figure on a running campaign.',
    sentence: RESERVED_IS_NOT_RAISED,
    specRef: '§20, §30',
  },
  {
    id: 'checkout_sentiment',
    reference: '“4.7/5 Checkout sentiment” as a headline tile.',
    sentence:
      'There is no satisfaction score here. Backers answer two optional questions at checkout, and you see the answers of the ones who agreed to share them — not a number computed from them.',
    specRef: '§19, §1.4',
  },
  {
    id: 'post_issue',
    reference: '“I have an issue” — a free-text box for flagging a Creator’s post.',
    sentence:
      'If something about a post is wrong, tell Proovd through support. Post reviews are ours to run — sending a complaint straight to the Creator is not a channel this product has.',
    specRef: '§20, §17, §30',
  },
  {
    id: 'acknowledgement_note',
    reference: 'A note attached to the acknowledgement.',
    sentence: ACKNOWLEDGEMENT_HAS_NO_MESSAGE,
    specRef: '§30, §11',
  },
  {
    id: 'page_visual_upload',
    reference: '“Add a visual” — a file input inside the page-update request.',
    sentence:
      'Image and video uploads are not available yet. Describe the change and Proovd will come back to you about the file.',
    specRef: '§12, Track A4',
  },
  {
    id: 'platform_sources',
    reference: '“Backer sources — Instagram · TikTok · Organic”.',
    sentence:
      'Proovd records which Creator link a pre-order came through, and whether it came from search or from us. Which app somebody was in when they clicked is not something we can see.',
    specRef: '§18, §1.4',
  },
  {
    id: 'creator_tracking_link',
    reference: '“Copy campaign link” copying a `/c/…` address.',
    sentence:
      'This is your campaign’s own address. The short links that start with /c/ belong to individual Creators — sharing one would credit them for people you brought in yourself.',
    specRef: '§18',
  },
];

export function liveAbsence(id: string): LiveAbsence {
  const found = LIVE_ABSENCES.find((a) => a.id === id);
  if (!found) throw new Error(`no Live absence '${id}'`);
  return found;
}
