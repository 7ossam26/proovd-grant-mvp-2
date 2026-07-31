# Prebuilt files — read before the master plan

These are **canonical reference implementations**, not suggestions. They exist because two items in the tech stack are load-bearing, easy to implement subtly wrong, and produce failures that no test or code review catches until much later.

Hand these to Claude Code as existing files. Its instruction for both is **use, do not reinvent**.

---

## What each file is

```
frontend/
├── index.html                              vendor load order (DNA §6.7)
├── public/
│   └── proovd-motion.js                    patched — corrected vendor paths + React warning
└── src/motion/
    ├── proovd-motion.d.ts                  types for window.Proovd
    └── MotionProvider.tsx                  the React integration layer

backend/src/
├── db/schema/tokens.ts                     Drizzle schema for draft + magic-link tokens
└── auth/token-service.ts                   issue / rotate / verify / claim / revoke
```

Drop them into the repo at those exact paths. Also still needed in `frontend/public/`:

```
vendor/gsap/{gsap,ScrollTrigger,Flip,SplitText,TextPlugin,ScrambleTextPlugin}.min.js
proovd.css
fonts/Satoshi-Variable.woff2
fonts/Satoshi-VariableItalic.woff2
gsap-check.html          ← serve once, confirm every row reads OK, then exclude from prod
```

---

## Fix 1 — the motion binding problem

**The defect.** `proovd-motion.js` exposes `init(root)`, which walks the DOM with `querySelectorAll` and attaches listeners to whatever nodes exist at that moment. React replaces DOM nodes on re-render. The listeners survive on nodes that are no longer in the document.

Nothing throws. No console error. No failing test. The product just animates less as it grows, and by the time anyone notices, the cause is a hundred commits back.

**The fix.**

- `proovd-motion.d.ts` types the whole `window.Proovd` surface. Without it every call is `any`, which deletes the review pass TypeScript is in the stack to provide. Signatures were read from the runtime source, not guessed.
- `MotionProvider.tsx` gives four things:
  - `<MotionProvider>` — mount once inside the router. Publishes the runtime through context and re-runs `init()` after each navigation, in `useLayoutEffect` so bindings land before paint. Also catches the deploy bug where the script tag is wrong and `proovd-motion.js` never runs at all — in which case its own fail-loud notice can't render either, so the provider renders one.
  - `useProovdMotion(ref, deps)` — the actual fix. Any subtree rendering `data-reveal`, `data-hover`, `data-press`, `data-scroll`, `data-progress`, `data-count-to`, `data-grid`, `data-accordion`, `data-tabs`, or `data-splash` on content that can change calls this with the deps that change it.
  - `useGsapScope` — wraps hand-written GSAP in `gsap.context()`, reverted on unmount and between React 19 StrictMode's double-invoked effects. Without it every animation binds twice in development and press handlers fire twice.
  - `useToast` / `useButtonProgress` / `useNumberRoll` — imperative wrappers for state-driven motion, which must never use declarative attributes.

**The rule to give Claude Code:** static content is covered by the provider's navigation-level init. Anything fed by TanStack Query, any conditional branch, any list — `useProovdMotion`. Anything driven by React state — imperative API.

**One thing I changed in `proovd-motion.js`:** its header documented `vendor/gsap.min.js`; the real layout is `vendor/gsap/gsap.min.js`. Corrected, and added the React warning plus the "never import this, never install the gsap npm package" note. No logic touched — the runtime is byte-identical below the comment block.

---

## Fix 2 — Backer authentication

**The defect.** Better Auth ships a magic-link plugin, it's already in the stack, and it's the obvious thing to reach for. It is wrong here, and wrong in a way that only surfaces after the data model is built on it.

Better Auth's magic link **creates a user account and a session**. Spec §5.4 says Backers are guest-only with no password account. Spec §19 requires campaign-scoped access — a link grants access to that Backer's view of *that campaign* and its transactions, nothing else. An account-based session can't express that scope.

Build on the plugin and you get Backer accounts that shouldn't exist, sessions that span campaigns, and a §33.5.13 acceptance test that can't pass without a rewrite.

**The fix.** One table, one service, covering both tokenised surfaces — Founder draft links and Backer magic links — because Spec §28.1 imposes an identical contract on them.

Decisions inside worth knowing about:

- **SHA-256, not bcrypt or argon2.** Password hashes are deliberately slow because passwords are low-entropy. These tokens carry 256 bits of CSPRNG entropy; there's nothing to brute-force, and a slow hash on every magic-link page load is a self-inflicted denial of service.
- **Every failure returns the identical value.** Invalid, expired, revoked, claimed, malformed, rate-limited, and never-existed are indistinguishable to the caller. The real reason goes to the audit log. Spec §5.5 forbids exposing account existence; a helpful error message here is a user-enumeration vulnerability. There is deliberately no reason field on the error type — if one existed, someone would eventually render it.
- **Concurrent draft claims are settled by a conditional `UPDATE`,** not select-then-update. The second caller's `WHERE` matches zero rows and gets the standard rejection. That's Spec §33.1.2's "two concurrent claims yield one account and one failed safe response" as a database guarantee.
- **A partial unique index enforces one live token per lineage.** Rotation must revoke before it issues, so a half-completed rotation can't commit.

**Two things the migration needs by hand** — drizzle-kit won't generate them from the schema. Both are written out at the bottom of `tokens.ts`: the scope-binding `CHECK` constraint, and the partial unique index above.

**Still to wire:** the Express middleware that reads the token from the URL, calls `verify()`, and attaches the scoped subject to the request. That's route-shaped, so it belongs in the phase that builds those routes — but it must call this service rather than reimplementing verification.

---

## What these files deliberately do not do

They implement the *security and integration contract* only. They contain no campaign logic, no fee calculation, no state transitions, no copy. Spec §1 rule 6 forbids implementation from inventing commercial rules, and that applies to reference files as much as anything else.

---

## Not fixable by editing files

For completeness, the other four concerns from the review. None is a defect:

| | Status |
|---|---|
| Tailwind removed | A decision. `proovd.css` already works as-is. |
| Routes on `app.proovd.co` | A decision, recorded in tech-stack-v2 §10. Set the canonical redirect when the app deploys. |
| Satoshi self-hosted | Just needs the two `.woff2` files in `frontend/public/fonts/`. `proovd.css` already declares `@font-face` against those exact paths. |
| Cal.com | A decision. Nothing to build until the phase that needs it. |

The contrast exception (tech-stack-v2 §3.6) is also still open, but it's a design sign-off, not code.
