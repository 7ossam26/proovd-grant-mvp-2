/**
 * The Resources screen — Creator Flow v2 **deviation 4**, Session A, 2026-08-19.
 *
 * ═══ A RECORDED DEVIATION FROM §1 RULE 6, BY EXPLICIT PRODUCT DIRECTION ═════
 *
 * The reference draws four tiles — `Marketing Toolkit`, `Content Templates`,
 * `Best Practices Manual`, `Campaign Tracking and Analytics` — whose action is
 * *"We'll email you when it's ready."*
 *
 * §14.1's last line: *"All material lives in one Campaign kit. No separate
 * resource-library or education journey is required."* §30 defers *"Reusable
 * Affiliate course/resource library; the single Campaign kit is required."*
 *
 * ── What keeps §14.1's sentence true is a SEPARATION, and it is structural ──
 * The Resources record carries **no campaign material and no campaign
 * reference**. It is a list of four things that do not exist yet, plus an
 * interest record: a resource key, a subject, and a timestamp — and no column
 * that could hold an asset, a URL, a file, or a campaign id. A test asserts
 * those columns are absent from `information_schema`.
 *
 * So it does not replace the §31.5 Campaign kit and **cannot become it**. The
 * kit is per campaign, access-logged, and revocable (08c); this is a signup
 * sheet for material nobody has written. The moment a column here could hold a
 * file, the two would be the same thing and §14.1's sentence would be false.
 *
 * ── Why it exists at all ───────────────────────────────────────────────────
 * Because "we might build this" is a real thing to tell somebody, and the
 * honest way to tell them is to say it is not built and offer to say when it
 * is — rather than a tile that opens an empty page. §1.4 in its ordinary form.
 *
 * ── What a later phase must not read this as licence for ───────────────────
 * Not a content library. Not campaign material outside the kit. Not an
 * education journey.
 */

/**
 * The four tiles, kept as the reference names them.
 *
 * Each carries `notBuilt` as a required field rather than a flag, because the
 * whole register describes things that do not exist — a tile without that
 * sentence is a tile somebody will read as available.
 */
export const CREATOR_RESOURCES = [
  {
    id: 'marketing_toolkit',
    label: 'Marketing toolkit',
    summary: 'Reusable graphics and layouts that are not tied to one campaign.',
    notBuilt:
      'Not built. Everything you need for a campaign you are on is in that campaign\'s own kit.',
  },
  {
    id: 'content_templates',
    label: 'Content templates',
    summary: 'Starting points for posts, in your own words.',
    notBuilt:
      'Not built. Your current campaign\'s kit carries its own disclosure templates and assets.',
  },
  {
    id: 'best_practices',
    label: 'Best practices',
    summary: 'What has worked for other Creators, written down.',
    notBuilt: 'Not built. Nothing here yet.',
  },
  {
    id: 'tracking_and_analytics',
    label: 'Tracking and analytics guidance',
    summary: 'How attribution works, and what the numbers on your campaign mean.',
    notBuilt:
      'Not built. Each campaign explains its own numbers where they are shown.',
  },
] as const;

export type CreatorResourceId = (typeof CREATOR_RESOURCES)[number]['id'];

export const CREATOR_RESOURCE_IDS: readonly string[] = CREATOR_RESOURCES.map((r) => r.id);

export function creatorResource(id: string) {
  return CREATOR_RESOURCES.find((r) => r.id === id);
}

/* ── The pinned sentences ─────────────────────────────────────────────────── */

/**
 * Pinned. Renders at the top of the Resources screen, above the tiles.
 *
 * §14.1's own sentence, in the Creator's words, on the one surface that would
 * otherwise contradict it. It is also what stops somebody looking here for
 * campaign material and concluding it is missing.
 */
export const RESOURCES_ARE_NOT_THE_CAMPAIGN_KIT =
  'Everything for a campaign you are on lives in that campaign\'s own kit, on the campaign. Nothing here replaces it — these are general guides we have not written yet.';

/**
 * Pinned. Renders on the interest control.
 *
 * The honest version of "We'll email you when it's ready". §27 defines no
 * resource notification key, so what is recorded is interest — and the sentence
 * says the product will not chase them, which is true because there is no
 * schedule column and no job that reads the table (§30).
 */
export const RESOURCES_INTEREST_IS_RECORDED =
  'We will note that you want this. There is nothing to send yet and no reminder attached — you will hear once if we build it.';

/**
 * Pinned. Renders where the reference put a download control.
 *
 * §1.4: a control that does nothing is worse than no control. There is no
 * download, because there is no file — and a disabled button would invite
 * somebody to work out how to enable it.
 */
export const RESOURCES_HAVE_NOTHING_TO_DOWNLOAD =
  'Nothing to download. When one of these exists it will arrive as its own thing, not as an empty page.';
