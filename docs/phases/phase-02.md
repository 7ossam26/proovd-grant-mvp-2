# Phase 02 — Design system

**Model:** Opus 4.8 — High component count, but the traps are subtle: Radix portals, disabling default transitions, and the contrast exception a weaker model will 'helpfully' correct.

**Goal:** every element in DNA §7.1's identity table exists as a React component, correct in all four section modes, animated through GSAP, keyboard- and screen-reader-navigable at 320px, and proven by a gallery route. Plus the two structural primitives every later surface is built from: the six-question state panel and the one-thing-per-screen flow.

No product surfaces here. No routes a user will ever see. This is the vocabulary the remaining twenty-two phases speak in — build it wrong and every phase after inherits it.

---

## Read first

- `docs/spec/Proovd_DNA.md` — all of it. §1 (colour + hard rules), §2 (border/radius), §4 (spacing/layout), §5 (the UX filter), §6 (motion), §7 (element identity), §8 (screens), §9 (sizing)
- `frontend/public/proovd.css` — the token, slot, and component system
- `docs/README-prebuilt.md` — why `MotionProvider.tsx` exists
- `docs/tech-stack-v2.md` §3 — the frontend contract
- Spec Appendix B.1 — the reusable waiting/review microcopy pattern
- Spec §28.5 — accessibility and responsive baseline

---

## Prerequisites

Phase 01 green. `index.html`, `MotionProvider.tsx`, and `proovd-motion.d.ts` present at their paths.

---

## Scope

### 1. Motion layer

`index.html` is already written and its vendor script order is mandated by DNA §6.7 — **do not regenerate it.**

Mount `<MotionProvider>` at the app root, inside the router so it can observe navigation. Confirm `window.Proovd` resolves and `Proovd.failed` is `false`.

Then prove the failure path works: temporarily rename a vendor file, reload, and confirm `html.no-motion` is applied, the accent-yellow notice renders, and every control is still reachable and operable. Restore the file. DNA §6.6 — a frozen screen is worse than no animation, and a silent downgrade is worse than both.

### 2. Section modes and layout

Wrappers for `.mode-none`, `.mode-dark`, `.mode-light`, `.mode-drawer`. Components read slots; **a component never chooses a colour, only a mode.**

Layout primitives from `proovd.css`: `.wrap`, `.section`, `.section--breathe`, `.cols`, `.grid-auto`, `.measure`, `.dock`.

### 3. The identity table (DNA §7.1)

One treatment per role, and no two roles share one. The test is **cover the copy**: hide every word on screen and you must still be able to point at what's typeable, what's tappable, what's on/off, and what's information.

| Component | Built on | Notes |
|---|---|---|
| Input / Textarea | native | The **only** grey-bordered tappable. Always a visible writing affordance — placeholder or label. Focus morphs, border tweens to brand. |
| Toggle | Radix Switch | Sits bare on the page with its label and sub-line. Never inside a bordered card. Square knob travels. |
| Checkbox / Option | Radix Checkbox | Off: grey border + icon. On: brand border + 5% fill + drawn check. |
| Stepper | custom | The size of the number **is** the container. No outer box. |
| Button ×3 tiers | native | primary filled / secondary brand-border / tertiary plain bold text. Adjacent actions descend tiers — never two of the same tier side by side. |
| Tag | custom | Live/action: brand border + 5% fill + brand text (+ dot). Quiet info: filled, no ring. |
| Card | custom | Brand border, never grey. Used only when content genuinely needs a boundary (DNA §4.2). |
| Link | native | Section-mode colour, underline draw on hover. |
| Progress | custom | Always the bordered treatment. Nothing else, ever. |
| Copylink | custom | Brand border + text + border-only button, one-click copy confirmation. |
| Sticker | custom | `.sk-1`–`.sk-14`, contextual to background. Placeholders and stickers only. |
| Drawer / Sheet | Radix Dialog | Side panel ≥600px, bottom sheet below, safe-area padded. |
| Modal | Radix Dialog | Grows from its trigger. Never fades in from a centred void. |
| Menu | Radix DropdownMenu | |
| Accordion | Radix Accordion | Height morph, chevron rotates 45°. |
| Tabs | Radix Tabs | Underline via `Flip.fit`. |
| Toast | `Proovd.toast` | Imperative only. |
| Stat | custom | mint / dark / white-with-brand-ring variants. |

**Radix contributes behaviour and ARIA, nothing visual.** Use `asChild` so `proovd.css` classes land on the real element, and disable every default `data-state` CSS transition — all motion runs through GSAP (DNA §6).

### 4. StatePanel — the six-question pattern

Spec §27.1 requires every waiting, review, payment, recovery, and exception state to answer six questions. Appendix B.1 gives the shape. Build it once as a component:

```
what happened · what next · who owns it · next update by · your action · reference · get help
```

`ownerRole` is one of Proovd / Founder / Creator / Stripe / You. `action` is a single control or the literal string `No action needed`. `getHelp` preserves context — it never dumps the user into a blank support form.

Every phase from 05 onward uses this. Nobody hand-rolls a waiting state.

### 5. Flow — one thing per screen (DNA §5.9)

The primitive behind Founder vetting, campaign building, Creator decisions, and checkout. Not a form component — a sequence controller.

- One input, one decision, or one action per step; the current step is the hero.
- Animated transition in one consistent direction; forward is left, back is right (DNA §6.5).
- Finite and visible: remaining step count goes down.
- **Back always works.** Any step is returnable to. An overview of every step sits one gesture away in Explore.
- Advance with momentum when an answer is unambiguous and safe; confirm when stakes are high.
- Ends with a summary moment — everything entered, in one glance, editable — then closure.
- Progress, entered values, and scroll depth survive interruption (DNA §5.12).

### 6. Glance / Act / Explore scaffold

The three-altitude layout from DNA §5.2, used by the Founder campaign home (Phase 17) and the Admin panel. Glance + Act is the default view; Explore is always reachable and never the landing state.

### 7. Accessibility baseline

320px through desktop. 44px minimum touch targets. Visible focus order matching reading order. Programmatic error association. Screen-reader names on every control. Complete keyboard paths. No clipped amount, date, or action. `prefers-reduced-motion` collapses to quick fades with full text rendered at once and no loss of function.

### 8. The gallery

A development-only route rendering every component in every section mode, both motion states, and both breakpoints. Excluded from the production build.

This is the phase's proof, and it stays useful — it's where you check a component before using it in a real surface.

---

## Out of scope

Any product surface. Any route a user reaches. Data fetching. Auth. Campaign concepts of any kind.

---

## Traps

- **Do not "fix" the brand button contrast.** `#41ED98` fill with `#E9FFE1` text measures 1.44:1 and is a *recorded exception* — see `docs/tech-stack-v2.md` §3.6. Substituting a darker text colour violates DNA §1's hard rule. Everything else must independently pass AA.
- **Radix portals mount outside the React tree position.** Dialog and DropdownMenu content lands at the document root, so a `useProovdMotion` call scoped to the trigger's subtree will miss it. Scope to the portal content.
- **Never two same-tier buttons adjacent** (DNA §7.1). Adjacent actions descend the tiers.
- **Grey borders belong to inputs at rest and nothing else** (DNA §1, §7.1).
- **The texture quota is a rule, not advice** (DNA §7.2). A screen of white + grey borders + one green button is illegal even when every element is individually correct.
- **SplitText must revert after every reveal.** Leftover split spans break selection, screen readers, and reflow — and would fail §33.11.
- **Body copy is never animated** beyond its container's entrance.
- **Don't invent components.** If it isn't in `proovd.css`, extend that file in the same slot-reading style rather than starting a parallel system.
- **Copy economy applies here too** (DNA §5.7). No helper line under every control, no subtitle restating the button. Run the deletion test.

---

## Done when

- [ ] Gallery renders every identity-table component in all four section modes
- [ ] **Cover-the-copy test passes** — with all text hidden, every control's role is still identifiable
- [ ] Full keyboard traversal; visible focus; order matches reading order
- [ ] 320px, 600px, 900px, and desktop all compose correctly; dock active below 600px and never covers content
- [ ] Every touch target ≥44px
- [ ] `prefers-reduced-motion` collapses to fades, shows full text at once, loses no function
- [ ] Renaming a vendor file produces `html.no-motion` + the yellow notice, and nothing becomes unreachable
- [ ] Satoshi verification passes; forcing it to fail surfaces the notice
- [ ] StatePanel and Flow both demonstrated in the gallery
- [ ] No hex literal, arbitrary spacing value, or stray `px` outside borders/radii/44px anywhere in `frontend/src`

**Acceptance:** §33.11.1 (principal flows at 320px, desktop, keyboard, screen reader), §33.11.2 (labels, errors, focus, amounts, dates, actions intact). Partial credit toward §33.11.7.
