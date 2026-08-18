# Handoff: Proovd Founder Flow

## Overview
The Proovd founder onboarding flow: the complete path a founder walks from opening a pre-filled
invite to a live crowdfunding campaign. Twenty-six full-screen steps covering invite claim,
problem/solution confirmation, campaign type selection, email sign-in, the eight vetting answers,
personal details, creator matching and pay model, review, listing fee payment, campaign page
building (voice, goal, FAQs, rewards), Stripe payout setup, and the live confirmation.

Every step is a full-bleed page — there is no persistent app chrome, no header, no progress bar,
no navigation dock. Each page owns its whole viewport and its own entrance animation. The only
recurring furniture is the Proovd wordmark top-left, a HELP button top-right, and on some pages a
message badge bottom-right.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype of the
intended look, motion, and behavior. They are **not production code to copy**. The task is to
**recreate these designs in the target codebase's existing environment** (React, Vue, SwiftUI,
native, whatever is in use) following its established patterns, component library, and routing.
If no environment exists yet, pick the framework that best fits the project and build there.

The prototype is a single self-contained HTML file. Its internal structure (one component holding
all pages, inline styles, a hand-rolled step machine) is a prototyping convenience, **not an
architecture recommendation**. In a real app each page should be its own component/route.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, imagery, motion, and interaction states.
Recreate the UI pixel-accurately using the codebase's existing primitives. Every measurement in
this document is exact.

### Critical: the desktop scaling model
Desktop pages are authored on a **2496 × 1542 px design stage**, absolutely positioned and scaled
to fit the viewport:

```
width: 2496px; height: 1542px;
position: absolute; left: 50%; top: 50%;
transform: translate(-50%, -50%) scale(0.37);
transform-origin: center center;
```

So a "92px headline" in this document renders at roughly 34 CSS px at the default 0.37 scale.
**Two options when rebuilding:**
1. Keep the fixed-stage approach (compute scale from viewport width; predictable, matches the
   prototype exactly), or
2. Convert every value: divide by 2.7 to get approximate CSS px at a 1440-wide viewport, then
   express as responsive units.

Option 2 is usually right for production. Either way the **ratios in this document are the source
of truth** — preserve relative proportions.

Mobile pages are separate branches (`kindPhone` / `claimPhone` / `probPhone`) authored in
normal viewport units with `min(Nvw, Mpx)` clamps. Breakpoint: **max-width 760px**.

## Design Tokens

### Colors
| Token | Hex | Use |
| --- | --- | --- |
| Brand green | `#41ED98` | Primary CTAs, active borders, accents, focus rings, wordmark |
| Brand green hover | `#3BDC8C` | CTA hover |
| Deep green | `#013F17` | Body text, headlines, dark buttons, dark panels |
| Deep green dark | `#012D10` | Drawer background, deepest text |
| Page background | `#FAFAFA` | Every page background, button text on green |
| Pale green | `#E9FFE1` | Tinted fills, text on dark green |
| Neutral grey | `#A2AFA8` | Placeholder text, inactive borders, secondary copy |
| Mid green | `#8FCBA3` | Upload zone dashes and label |
| Muted green | `#4E8C67` | Dashed borders in modals |
| Rule green | `#4E785C` | Dashed field underlines |
| Pale yellow | `#F4FFA0` | Voice replacement modal frame |
| Cream | `#FBFFD4` | Discount pill |
| Pale blue | `#DEFAFC` | Invite band, dashed drop-panel border |
| Row blue | `#DEF6FF` | Added-file rows |
| Card grey | `#F5F5F5` | Reward card panel |
| Preview green | `#E7F7EA` | FAQ preview panel |
| Legal grey | `#B4B4B5` | Legal microcopy |
| Border grey | `#E4E4E4` | Inactive affiliate chip border |
| Disabled grey | `#D6D6D6` | Disabled pager arrows |

### Typography
**Satoshi** only, self-hosted woff2/woff at weights 400, 500, 700, 900 (`font-display: swap`).
- Headlines: 700 or 900, `letter-spacing: -0.03em` to `-0.04em`, `line-height: 1.05–1.3`
- Body: 500, `letter-spacing: -0.012em`, `line-height: 1.4–1.5`
- Labels/tags: 900, `letter-spacing: 0.06em–0.16em`, uppercase
- `text-wrap: pretty` on multi-line paragraphs

Desktop stage sizes (divide by ~2.7 for CSS px at 1440): hero 290–360px, page headline 88–150px,
section headline 62–112px, body 35–72px, field text 46–104px, label 22–34px.

### Geometry
- **Border radius: 2px everywhere.** Never rounded. The only exceptions are 1px on a few small
  invite-page buttons and 99px on the slim scrollbar thumb.
- Border widths: 2px standard, 3–5px emphasis, 8–17px on the live-page button outline
- Dashed rules: `repeating-linear-gradient(90deg, COLOR 0 14px, transparent 14px 27px)` at 5px tall
  (hand-built, not `border-style: dashed`, so dash and gap are controllable)
- Inset highlight on green CTAs: `box-shadow: 0px 3px 12px rgba(255,255,255,0.42) inset`

## Motion

GSAP 3 (plus Flip and SplitText, both loaded but lightly used). All motion is JS-driven; no CSS
keyframes except where noted.

### Page entrance (every page)
Children carrying `data-anim` (`pill, head, field, boxes, note, fee, sub, hint, panel, art, art2,
cta, edit`) are staged and relayed in:
```
from: { x: 150 * direction, opacity: 0 }
to:   { x: 0, opacity: 1 }
duration: 0.62s   ease: power3.out   stagger: 0.085s
```
`direction` is +1 forward, −1 back; on back navigation the stagger starts from the **last** child
(`from: 'end'`). First paint always runs forward.

**Exception:** an element marked `data-anim="grow"` scales in instead —
`from { scale: 0.6, opacity: 0 }`, 0.62s `back.out(1.35)`. Used for the "It's a match!" lockup.

### Page exit (full-bleed overlays)
The outgoing page's stage fades `opacity → 0` over 0.28s `power2.in`, then state swaps. A 520ms
fallback timer guarantees the transition completes if a tween stalls (e.g. a background tab).

### Named sequences
| Sequence | Spec |
| --- | --- |
| **Campaign type select** | Sticker scales to 1.55 (0.26s `power2.out`) while headline/copy/CTA fade out (`opacity 0, y −10`, 0.18s). Then a FLIP: the chosen row's sticker is inverted to the swollen sticker's exact rect and tweened home over 0.52s `power3.inOut`. The chosen row only fades (0.24s); the other row slides up 16px; Confirm fades up 14px after 0.14s. Invert is set synchronously before paint; the tween starts on the next frame. |
| **Say it instead → recording** | Next button collapses `width → 0, opacity 0` (0.24s) while the row gap closes and the mic button grows to full row width (0.28s, `power2.inOut`), then a 0.12s fade. Recording controls rise `y 14 → 0` (0.26s `power3.out`, 0.05s stagger); 72 wave bars grow `scaleY 0 → 1` (0.3s, 0.003s stagger from center). |
| **Voice chip modal** | Sheet is inverted to the clicked chip's rect (translate + non-uniform scale, min 0.12) and tweened to identity over 0.46s `power3.out`; scrim fades in 0.4s; inner rows stagger `y 16 → 0` (0.34s, 0.06s, 0.16s delay). |
| **Cupids (creator match)** | Left/right images slide `xPercent ∓120 → 0` with opacity, 0.8s `power3.out`, 0.12s delay. They hang off the page (not the scaled stage) at 34vw so they crop at the real viewport corners. |
| **Message badge** | Idle shake on a loop: rotate −9° → 8° → −6° → 4° → 0 (0.07/0.09/0.09/0.09/0.12s), repeating every 6s. |
| **Mic visualizer** | 72 bars, height from a sine/cosine product, `scaleY` yoyo 0.28 → 1 at 0.45s with 0.09s per-bar delay. A gradient mask sits behind the LISTENING label so text never collides with bars. |
| **Campaign review** | Holds 5s, affiliates flip to accepted at 1.5s and 3s, then auto-advances to the live page. |
| **DOB calendar** | Month step fades days `y ±8` (0.22s); decade page slides years `x ±12` (0.22s, 0.012s stagger). |

### Motion housekeeping (worth replicating)
- Looping tweens are tracked and pruned when their targets leave the DOM, or they accumulate and
  the app degrades the longer it runs.
- A "stuck" sweep runs 2.2s after arrival: any `data-anim` element still below 0.9 opacity with no
  progressing tween gets its transform/opacity cleared, so a dropped tween can never leave a blank
  page.
- Heavy per-render lists (help documents, calendar grids) are computed only while visible.

## Screens

Flow order. Each is full-bleed on `#FAFAFA` unless stated.

### 1. Invite claim
Pale blue (`#DEFAFC`) band 285px tall, then headline "Ahmed, we loved talking to you about Teeb!"
at 90px/700 with a 28px `#E9FFE1` text-stroke (paint-order: stroke), body copy at 44px, full-width
CTA 122px tall, legal line 21px `#B4B4B5` with underlined links. Top row: "~3 mins" at 35px/700 and
a HELP button (196×60, 2px `#41ED98` border). A splash screen (green square with a dark inner
square) covers the page for up to 2.6s on load.

### 2–3. Problem / Solution confirmation
Headline "This is how we understood your **problem**" — the bolded word is a sticker image
(`sticker-problem.png` 175px / `sticker-solution.png` 140px) inline in the text, vertically offset
to sit on the baseline. Below: a `#013F17` panel with 60px 26px 68px padding wrapping a `#FAFAFA`
text area (98px 108px padding, 62px/500 text). Native scrollbar hidden; a custom 9px-wide rail sits
17px outside the right edge with a `#41ED98` thumb whose height and offset track scroll position.
An edit button (196×60, pencil icon + label) toggles read-only; editing grows the panel 220 → 478px
and collapses the Next button (height and margin animate to 0 over 0.45s). Next is 129px tall,
62px below the panel.

### 4. Campaign type
Headline "I'm working on an..." at 88px. Sticker (Idea 336px / Product 440px) flanked by 120×120
pager arrows with 2px `#41ED98` borders. Body copy 35px across 894px with the campaign type in
bold. Select button 98px tall. After Select, the page becomes two 206px-tall rows ("I have an
Idea" / "I have a Product", 62px labels, sticker at left, 56px gap, 62px side padding) plus a
104px Confirm button — see the motion table for the transition.

### 5. Sign in (email)
"What's your email?" with the address as a live input at 104px/700, dashed `#41ED98` underline,
112px from the headline. **Text turns `#A2AFA8` while the field has focus** and returns to
`#013F17` on blur. No header or footer on this page.

### 6. Six-digit code
"Enter the six digit code we just send you" at 62px, six 168×168 boxes (2px `#A2AFA8` border,
76px/700 centered text, border turns `#41ED98` on focus, 22px gap). Below: "Code sent to
**ahmed.ehab@teeb.com.** didn't get a code? resend" at 30px, resend underlined in `#41ED98`.
Clicking resend greys it and counts down "resend again in 49s". Typing auto-advances between boxes;
the sixth digit advances the flow — there is no submit button.

### 7–14. The eight vetting answers
Ordered: Problem, Solution, Positioning (all required), then Visuals, Branding, Interview, Story,
Socials (bonus). Each bonus answer completed drops the listing fee $2.

- **Positioning / Story** — headline, large textarea, then "Say it instead" (mic icon, 660×150,
  3px `#41ED98` border) beside Next. Recording state: 176×176 pause and stop buttons with labels,
  a live timer, "LISTENING" at 26px/900 tracking 0.16em, and the 72-bar visualizer behind a
  `#FAFAFA` gradient (transparent → 0.18 → 0.5 → solid over 130px) so words never sit under it.
  The textarea auto-scrolls as dictation arrives and carries 210px bottom padding to clear the bars.
- **Visuals** — "We want to see your product..." at 112px, left-aligned; the container hugs the
  headline so the panel and Next align to its right edge. Upload zone 500px tall, `#E9FFE1` fill,
  5px dashes at 15px on / 15px off in `#8FCBA3`, solid down-arrow glyph, "Tap to add a file" 44px,
  "PNG, JPG, MP4" 30px `#A2AFA8`. Link row: input with 4px `#41ED98` border + 290px dark Add
  button. Right column shows a 9px dashed `#DEFAFC` outline when empty, replaced by `#DEF6FF` rows
  reading "File 1 added" with a plain `x` once files exist.
- **Branding** — logo upload, then a custom HSV color picker: saturation/value square with a
  draggable handle, hue bar, editable hex field with a 58px pencil beside it and a dashed rule
  under both, three square swatch slots below.
- **Interview** — platform tiles (Meet/Zoom/Teams with brand colors) and time-slot chips.
- **Socials** — Instagram, X, Discord, Website rows; icons render as CSS backgrounds (not `<img
  src>`) so an unresolved value can't fire a failed request.

### 15. Last look
Card grid of all eight answers with ADDED / MISSING state, the running listing fee, and an edit
affordance per card. Jumping into a section from here returns you to Last look on that section's
Next instead of continuing forward. Cards scale 1.06 on hover.

### 16. Your details
Legal name and phone inputs; date of birth opens a custom calendar (month scroller, year mode,
decade paging, 18+ validation with an inline hint). Positions below the field or as a sheet
depending on space.

### 17. Creator match
"It's a match!" lockup (grows in), "3 Affiliates" at 198px/900, a breakdown list at 56px, sub at
74px, and a 640×134 dark CTA. Cupid images crop into the bottom corners.

### 18. Creator pay
Idea campaigns get an explainer; product campaigns get a pager of pay structures with art, body
copy, and a Select button, plus an upfront-fee modal.

### 19. Review
Waiting state; auto-advances after 5s.

### 20. Listing fee
$35 base, $2 off per bonus answer completed, $25 floor. Shows the original struck through, the
current fee, savings copy, and a "Saved $2" pulse toast when a bonus answer lands.

### 21–26. Campaign page build → live
- **Voice** — brand adjective chips ("Luxurious", "Youthful") with a dropdown caret; clicking one
  opens a replacement sheet (pale yellow frame) with preset options and a "+" that becomes a text
  field for a custom word; a second sheet (dark green frame) adds more adjectives plus a "Tell us
  more" textarea.
- **Goal** — funding target entry.
- **FAQs** — form on the left, live preview panel (`#E7F7EA`, 150px 130px padding, 820px min
  height, 88px title, 56px body) on the right at 1.12fr / 1.08fr. "Add FAQ" is dark green with a
  5px `#41ED98` border.
- **Backer rewards** — copy column (0.64fr) and card (1.46fr) with 80px gap. Card: `#F5F5F5`, 62px
  padding, 2:1 gift image, then inline-editable title (50px/900), "Delivered by" + MM/YY (both grey
  until filled, sharing one color), description (36px, no scrollbar), price (68px/700), 114×114
  pager arrows that go green when there's a card in that direction, and a 140px CTA reading
  "1/3 Add Rewards". "Delete reward N" sits **below** the card, outside it, centered, when more
  than one exists. Every field has a pencil icon and a dashed rule.
- **Get paid** — "Setup how you get paid" centered at 126px, "Prepare:" with the Stripe mark
  opposite, three 132px icon rows (government ID, US bank details, SSN/EIN), and a 184px
  "Take me to stripe" button.
- **Payouts ready** — "You're all set to get paid!" with a 900px piggy bank and Continue.
- **Campaign in review** — 1180px lens photo, "Campaign in review" at 150px/900, sub at 60px, three
  affiliate chips (132px initial block + text, 2px border; accepted = `#41ED98` border and
  `#013F17` avatar, pending = `#E4E4E4` / `#A2AFA8`) that flip to accepted one by one, and a grey
  footnote. Auto-advances after 5s.
- **You're Live!** — full `#41ED98` field, "You're Live!" at 340px/900 `#FAFAFA` on one line, sub
  at 72px across 1980px, and a 1560×176 `#FAFAFA` button with a **34px outside** `#013F17` stroke
  (use `outline`, not `border`, so the fill keeps its size) reading "Take me to my dashboard".

### Help drawer
Opens from the HELP button or the message badge. Right-side sheet (`#012D10`, max 27rem) titled
"Help" with the subhead "This page and everything before it". Lists a document card per page — the
current page first, marked "This page" with a `#41ED98` border and 8% green tint, earlier pages
marked "Done" with a `#1B4A2C` border. Each card is a title plus a one-line explanation, and taps
jump to that page.

## Interactions & Behavior
- **Enter key** advances the current page's primary action throughout.
- **Back** returns to the previous page with the relay reversed; from sign-in and the vetting steps
  it returns to the campaign type screen.
- **Auto-advance:** review (5s), campaign in review (5s), six-digit code (on sixth digit).
- **Fee recalculation** runs on every bonus answer completion, with a toast.
- **Section return:** editing a section from Last look returns there rather than continuing.
- **Validation:** DOB must be 18+; link fields validate URL shape; the code page accepts digits only.

## State Management
The prototype holds one flat state object. Rebuild as per-route local state plus a shared campaign
draft. Key fields:

- `si` — index into `['claim','problem','solution','kind','type','vetting','intake','match','model','approval','fee','build','live']`
- `authStage` (`choose|auth|email`), `emailStage` (`enter|code`), `email`, `authMethod`
- `vStep` 0–7, `vReviewing`, `fromReview`, `ans` keyed by the eight answer ids
  (`problem, solution, competition, visuals, branding, interview, story, socials`), each
  `{ text, urls[4], files[], platform, slot }`
- `kindIx` (0 Idea / 1 Product), `kindStage` (`pick|confirm`), `type` (`prebuild|prelaunch`)
- `brand` `{ logo, colors[] }`, `dH/dS/dV` for the picker
- `profile` `{ name, phone, dob }`, `dobOpen`, `dobView`, `dobYearMode`, `dobBase`
- `creatorModel`, `modelAck`, `upfrontAmount`
- `buildStep` 0–5 mapping to `['voice','goal','faqs','rewards','payout','paid']`,
  `pageStatus` (`draft|review|approved`)
- `rewards[]` `{ t, d, b, p }` max 3 with `rwIx`; `faqs[]`; `voiceWords[]` max 6
- `rec`, `recPaused`, `recSecs` for dictation; `crAccepted` for the review sequence
- `drawer` for the help sheet

Fee: `max(25, 35 − 2 × bonusAnswersCompleted)`.

## Assets
All in `assets/`. Sourced from the Proovd brand library and provided by the client — use the real
brand assets from your own pipeline rather than these copies.

- `proovd-logo.svg` — wordmark
- `sticker-idea.png`, `sticker-product.png`, `sticker-problem.png`, `sticker-solution.png` — campaign type and headline stickers
- `cupid-left.png`, `cupid-right.png` — creator match corners
- `match-lockup.png` — "It's a match!" headline art
- `reward-gift.png` — backer rewards card image
- `piggy.png` — payouts ready
- `review-lens.png`, `review-loupe.png` — campaign in review photo
- `stripe.svg`, `kyc-id.svg`, `kyc-bank.svg`, `kyc-ssn.svg` — payout setup
- `social-instagram.svg`, `social-x.svg`, `social-discord.svg`, `social-website.svg`
- `mail.png` — message badge envelope
- `mic.svg`, `tick.svg`, `pie-cursor.png`, `avatar.png`, `cash-hand.png`

Fonts in `fonts/`: Satoshi 400/500/700/900 woff2 + woff.
GSAP in `vendor/`: `gsap.min.js`, `Flip.min.js`, `SplitText.min.js`.

## Files
- `Proovd Founder Flow v2.dc.html` — the complete prototype. Open in a browser to walk the flow.
  Template markup first (each page a `<div data-NAME="1">` under an `<sc-if>` gate), then the
  logic class. Page roots in file order: `claim, problem, kind, verify, pconfirm, sched, brandlogo,
  brand, visuals, compet, rewards, payout, paid, campreview, livepage, faq, goal, voice, paynow,
  reviewwait, paypick, pay, match, hello, lastlook, socials, story, code`.
- `assets/`, `fonts/`, `vendor/` — everything the prototype loads.

To jump straight to a page while developing, the prototype exposes a `startScreen` prop with
values: Invite, Problem, Solution, Campaign type, Sign in, Vetting, Intake, Match, Creator pay,
Approval, Payouts, Fee, Build, Live.
