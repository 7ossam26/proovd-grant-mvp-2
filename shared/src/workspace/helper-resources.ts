/**
 * §12's Founder helper resources — static, copy-ready guidance.
 *
 * §12 names four subjects and one boundary: "The workspace contains static,
 * copy-ready guidance—not an embedded AI product—for: Competition, Branding,
 * Visuals, Story."
 *
 * ── Copy-ready is the whole mechanism ───────────────────────────────────────
 * §12 asks for reusable prompts. A prompt the Founder copies and runs in their
 * own tool is guidance. The same prompt behind a button here is an AI feature,
 * and §30 defers "AI pitch rewriting/refinement" by name. So every prompt below
 * is text with a copy affordance and nothing else: there is no generate route
 * on the server, no model client in the tree, and no field on any record that
 * would hold a generated result.
 *
 * The distinction shows up in the Story rule too. Voice and generated summaries
 * can supply raw material, while the Founder-written saved story is what counts.
 * The guidance can point at the tool; the product cannot do the writing.
 *
 * ── Why the text lives in `shared` ──────────────────────────────────────────
 * The workspace renders it and the Admin evidence panel quotes the rule the
 * Founder was shown. One copy, imported by both through Vite. The backend never
 * reads it — nothing here decides anything.
 */

export const HELPER_SUBJECTS = ['competition', 'branding', 'visuals', 'story'] as const;
export type HelperSubject = (typeof HELPER_SUBJECTS)[number];

export interface HelperPrompt {
  /** What the prompt is for, so the Founder knows before they copy it. */
  title: string;
  /** The prompt itself, copy-ready. Rendered as text, never executed. */
  text: string;
}

export interface HelperResource {
  subject: HelperSubject;
  title: string;
  /** One-glance summary (DNA §5.14 — Glance before Explore). */
  glance: string;
  /** The guidance itself. Each entry is one point, not a paragraph wall. */
  points: readonly string[];
  /** §12's "reusable prompts". Absent where §12 does not ask for one. */
  prompts: readonly HelperPrompt[];
  /** What §12 forbids on this subject, said plainly. */
  limits: readonly string[];
  specRef: string;
}

export const HELPER_RESOURCES: readonly HelperResource[] = [
  {
    subject: 'competition',
    title: 'Writing your competition and positioning',
    glance:
      'Name who else solves this, including doing nothing, and say honestly what makes yours different.',
    points: [
      'Direct competitors: products a Backer would genuinely choose instead of yours. Name them.',
      'Indirect competitors: different products that solve the same problem a different way.',
      'The status quo: what someone does today when they have this problem and buy nothing. It is usually your biggest competitor.',
      'If you use an AI tool to research, treat what it returns as a starting list to verify — not as an answer.',
      'Cite your sources. A link to the competitor, the pricing page, or the review you read.',
    ],
    prompts: [
      {
        title: 'Research prompt — build a list to verify',
        text:
          'I am researching the competitive landscape for a product I am developing. ' +
          'Here is what it does: [DESCRIBE YOUR PRODUCT IN TWO SENTENCES]. ' +
          'List (1) direct competitors, (2) indirect competitors solving the same problem differently, ' +
          'and (3) what someone does today if they buy nothing at all. ' +
          'For each, give me the product name and a link I can check myself. ' +
          'Do not guess at prices, funding, or company size — if you are not sure, say so and leave it out.',
      },
    ],
    limits: [
      'Do not state a fact about a competitor you have not checked yourself.',
      'Do not present anything an AI tool produced as research you did.',
      'Proovd never pre-writes this section for you. It is the part that shows us how you think.',
    ],
    specRef: '§12 · Founder helper resources · Competition',
  },
  {
    subject: 'branding',
    title: 'Finding a brand direction that is yours',
    glance:
      'Decide colours and typography deliberately, so your page does not look like every other page.',
    points: [
      'Start from the product and the person it is for, not from a style you liked somewhere else.',
      'Pick a small palette and write down where each colour is used. Two or three is plenty.',
      'Pick typography and say what it is doing — serious, warm, technical, plain.',
      'Write the direction down. A direction you can hand to someone else is a direction; a feeling is not.',
      'Generic is the failure mode. If the direction would fit any product in your category, it is not yet a direction.',
    ],
    prompts: [
      {
        title: 'Brand-direction prompt — specific, not generic',
        text:
          'Help me write a brand direction for a product. Product: [WHAT IT IS]. ' +
          'Who it is for: [WHO]. What makes it different: [WHAT]. ' +
          'The feeling I want someone to have when they see the page: [FEELING]. ' +
          'Give me: a palette of three to four colours with a note on where each is used, ' +
          'a typography choice with a sentence on why it fits, and three words that this brand is NOT. ' +
          'Avoid anything that would apply equally well to every product in this category — ' +
          'if a suggestion is generic, say so and give me a more specific one.',
      },
    ],
    limits: [
      'The direction has to name at least colours and typography or style to count as complete.',
      'You approve it. Nothing is used on your campaign page until you do.',
    ],
    specRef: '§12 · Founder helper resources · Branding',
  },
  {
    subject: 'visuals',
    title: 'Making visuals that look like your product',
    glance:
      'Show the real thing where you can, keep everything in one visual language, and never imply a stage you have not reached.',
    points: [
      'A real photo of a real prototype beats a beautiful render of something that does not exist.',
      'If you use a render or a mock-up, say what it is on the page. A Backer deciding to pre-order is entitled to know.',
      'Keep every visual in one visual language — same palette, same framing, same background treatment.',
      'Check the visual at phone size. Most Backers will never see it larger.',
      'Avoid the generic look: floating product on a gradient, stock hands, invented awards or press logos.',
    ],
    prompts: [
      {
        title: 'Visual-brief prompt — for whoever or whatever makes the image',
        text:
          'Write me a visual brief for a campaign image. Product: [WHAT IT IS]. ' +
          'Brand direction: [PASTE YOUR SAVED DIRECTION]. ' +
          'The single thing this image has to communicate: [ONE THING]. ' +
          'Give me: composition, lighting, background, what is in frame and what is deliberately not, ' +
          'and the framing at phone size. ' +
          'Do not include anything that implies a stage of development, a partnership, an award, ' +
          'or a review that I have not told you about.',
      },
    ],
    limits: [
      'Nothing may misrepresent what exists today. A visual that implies a finished product you do not have is a claim, and Proovd reviews claims.',
      'Empty files, placeholders, and duplicates do not complete the item.',
    ],
    specRef: '§12 · Founder helper resources · Visuals',
  },
  {
    subject: 'story',
    title: 'Getting your story out of your head',
    glance:
      'Talk it through out loud, summarise it, then write the version you are willing to put your name on.',
    points: [
      'The fastest way past a blank page is to say it out loud. Use a voice conversation and answer the questions below.',
      'Then summarise what you said — that summary is raw material, not the story.',
      'Write the public version yourself from that material. It is your campaign page, in your voice.',
      'Say what the problem cost you or someone you know, what you built, where it is today, and what a Backer is actually pre-ordering.',
      'Read it aloud before you approve it. Anything you would not say to someone in a room does not belong on the page.',
    ],
    prompts: [
      {
        title: 'Voice-conversation prompt — use in ChatGPT Voice Mode or similar',
        text:
          'I want you to interview me about a product I am building, out loud, one question at a time. ' +
          'Do not write my story for me — ask, listen, and follow up. ' +
          'Start with why this problem matters to me personally. Then ask what I tried first and why it did not work. ' +
          'Then ask what I actually built, and make me be concrete about what exists today versus what does not. ' +
          'Then ask who it is for and what changes for them. ' +
          'Keep going until I have said something I have not said before. Ask one question at a time.',
      },
      {
        title: 'Summary prompt — turn the conversation into raw material',
        text:
          'Here is a transcript of me talking about my product: [PASTE]. ' +
          'Pull out, in my own words wherever possible: the problem, what it cost, what I tried, ' +
          'what I built, what exists today, who it is for, and what changes for them. ' +
          'Quote me rather than paraphrasing where you can. Do not add anything I did not say. ' +
          'This is raw material for me to write from, not a finished piece.',
      },
    ],
    limits: [
      'A transcript is raw material, not a finished story. Nor is a generated summary.',
      'The version you write and save is the version that completes the item.',
    ],
    specRef: '§12 · Founder helper resources · Story',
  },
] as const;

export function helperResource(subject: HelperSubject): HelperResource {
  const found = HELPER_RESOURCES.find((r) => r.subject === subject);
  if (!found) throw new Error(`unknown helper subject: ${subject}`);
  return found;
}
