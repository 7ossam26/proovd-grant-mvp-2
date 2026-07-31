# Phase 0 — Repository setup

**You do this one, not Claude Code.** No code is written here. You are placing files, creating folders, and verifying that the design system actually loads. Everything after this is a Claude Code session.

Expect 30–60 minutes. Do not start Phase 1 until the checks at the bottom pass.

---

## Before you begin

Two repositories exist and stay separate:

| Repo | Domain | Status |
|---|---|---|
| Landing page (existing) | `proovd.co` | Deployed. **Don't touch it in this project.** |
| **`proovd-app` (this one)** | `app.proovd.co` | Empty. Everything below goes here. |

The app repo owns every public route the Spec requires, including the policy pages and campaign pages — not because they feel like marketing, but because §18's attribution cookie is first-party and must share an origin with checkout. See `docs/tech-stack-v2.md` §10.

---

## Step 1 — Create the folder structure

```
proovd-app/
├── CLAUDE.md
├── .gitignore
├── .env.example
├── README.md
│
├── docs/
│   ├── master-plan.md
│   ├── tech-stack-v2.md
│   ├── README-prebuilt.md
│   ├── spec/
│   │   ├── Proovd-MVP-Engineering-Implementation-Spec-v1_0.md
│   │   └── Proovd_DNA.md
│   └── phases/
│       ├── phase-00.md          ← this file
│       ├── phase-01.md
│       └── …
│
├── frontend/
│   ├── index.html
│   ├── public/
│   │   ├── proovd.css
│   │   ├── proovd-motion.js
│   │   ├── gsap-check.html
│   │   ├── vendor/gsap/
│   │   │   ├── gsap.min.js
│   │   │   ├── ScrollTrigger.min.js
│   │   │   ├── Flip.min.js
│   │   │   ├── SplitText.min.js
│   │   │   ├── TextPlugin.min.js
│   │   │   └── ScrambleTextPlugin.min.js
│   │   └── fonts/
│   │       ├── Satoshi-Variable.woff2
│   │       └── Satoshi-VariableItalic.woff2
│   └── src/
│       └── motion/
│           ├── MotionProvider.tsx
│           └── proovd-motion.d.ts
│
├── backend/
│   └── src/
│       ├── auth/token-service.ts
│       └── db/schema/tokens.ts
│
└── shared/
```

`frontend/`, `backend/`, and `shared/` will get their `package.json`, configs, and remaining source in Phase 1. Right now you're only placing files that already exist.

---

## Step 2 — Place the files

Everything in the delivered bundle is already at its correct path. Copy the tree in wholesale, then confirm against the list below.

### Documents → `docs/`

| File | Goes to | Note |
|---|---|---|
| `Proovd-MVP-Engineering-Implementation-Spec-v1_0.md` | `docs/spec/` | The source of truth. Unmodified. |
| `Proovd_DNA.md` | `docs/spec/` | **Use the cleaned copy in the bundle.** Your original had every markdown character backslash-escaped (`\#`, `\*\*`), which makes it noisy in context and harder to read. Same content, escaping stripped. |
| `tech-stack-v2.md` | `docs/` | |
| `master-plan.md` | `docs/` | |
| `README-prebuilt.md` | `docs/` | Explains the prebuilt code files |
| `CLAUDE.md` | **repo root**, not `docs/` | Claude Code loads it automatically. It only works at the root. |

### Design system → `frontend/public/`

| File | Note |
|---|---|
| `proovd.css` | Unmodified |
| `proovd-motion.js` | **Use the patched copy in the bundle.** Its header documented `vendor/gsap.min.js`; the real layout is `vendor/gsap/gsap.min.js`, so the comment now matches and carries the React warning. The runtime logic is byte-identical. |
| `vendor/gsap/*.min.js` | **Already renamed for you.** Your uploads arrived as `gsap_min.js`, `Flip_min.js` — underscores where dots belong. Left as-is, every `<script src>` would 404 and the whole motion layer would silently fall back to `html.no-motion`. |
| `gsap-check.html` | Vendor smoke test. Keep it for now; exclude from the production build in Phase 1. |
| `index.html` | Goes in `frontend/`, not `public/`. Vendor load order is mandatory — see DNA §6.7. |

### Prebuilt code

| File | Goes to |
|---|---|
| `MotionProvider.tsx`, `proovd-motion.d.ts` | `frontend/src/motion/` |
| `token-service.ts` | `backend/src/auth/` |
| `tokens.ts` | `backend/src/db/schema/` |

These are canonical. Claude Code's instruction is **use, do not reinvent**. `docs/README-prebuilt.md` explains why each exists.

### Files you supply yourself

**Satoshi** — you said you have these locally. Both go in `frontend/public/fonts/` with these exact names, because `proovd.css` already declares `@font-face` against them:

```
Satoshi-Variable.woff2
Satoshi-VariableItalic.woff2
```

If you only have static weights rather than the variable file, replace the two `@font-face` blocks at the top of `proovd.css` with one block per weight (400 / 500 / 700 / 900) — there's a comment at line 43 marking the spot.

Self-hosted, not the Fontshare link. DNA §3 requires it, and it's also faster: same-origin woff2 skips a third-party DNS lookup and TLS handshake, and browsers have partitioned HTTP caches by origin since 2020, so a public font CDN gives you no cross-site caching benefit anyway.

### The one file that must NOT go in

**`tech-stack.md` (the original).** It was written against a superseded product definition — payments deferred, discovery as v2, `MBP`, `pledge`, `tranche`, `Day 30`. If it sits in the repo, Claude Code will read it and build the wrong domain model with banned vocabulary baked into table names.

Delete it, or archive it somewhere outside the repo. Do not keep it "just in case."

---

## Step 3 — `.gitignore` and `.env.example`

Create `.gitignore` at the root:

```gitignore
node_modules/
dist/
build/
.env
.env.local
.env.*.local
*.log
.DS_Store
.vite/
coverage/
frontend/public/fonts/*.woff2
```

That last line is a judgement call: Satoshi is licensed, and committing font binaries to a public repo redistributes them. If the repo is private and your licence permits it, drop the line — otherwise keep the fonts out and document where they come from in the README.

`.env.example` — copy the environment contract from `docs/tech-stack-v2.md` §17. **Keys and values stay out of the repo entirely**; they live in Dokploy's environment configuration. `.env.example` carries the variable names only.

---

## Step 4 — Verify the design system loads

This is the step people skip, and it's the reason the motion layer breaks a month later.

1. Serve `frontend/public/` over HTTP. Anything works — `npx serve frontend/public` or `python3 -m http.server` from inside that folder. **Do not open the file directly with `file://`**; the script paths won't resolve.
2. Open `gsap-check.html`.
3. Every row under *Files loaded*, *Plugins registered*, and *Live tests* must read **OK**. The box should be moving, the split text animating, and the scroll test should turn green when you scroll down.

If anything reads FAIL, it's a path problem — check the Network tab for a 404 and confirm the vendor filenames have dots, not underscores. Fix it here. Do not carry it into Phase 1.

---

## Step 5 — Commit

```bash
git init
git add .
git commit -m "Phase 0: spec, design system, prebuilt integration layer"
```

---

## Done when

- [ ] `CLAUDE.md` is at the repo root, not in `docs/`
- [ ] Both spec documents are in `docs/spec/`, DNA using the cleaned copy
- [ ] The original `tech-stack.md` is **not** in the repo
- [ ] Six GSAP files in `frontend/public/vendor/gsap/`, all named with dots
- [ ] Both Satoshi `.woff2` files in `frontend/public/fonts/`
- [ ] `gsap-check.html` shows OK on every row
- [ ] The four prebuilt code files are at their paths
- [ ] `.gitignore` excludes `.env`; no secrets committed
- [ ] First commit made

---

## Also start now — Track A

None of this is code, and all of it has lead time that runs in parallel with the whole build. `docs/master-plan.md` §2 has the detail. The first one is the schedule risk:

1. **Stripe Connect platform application.** Longest lead item on the project. Underwriting for a crowdfunding-adjacent platform takes real time and can return conditions. Everything in §34 waits on it, and the grant requires real money.
2. **The eight policy documents → legal review.** §18 and §31.4 need complete canonical text, no placeholders.
3. **Tax configuration.** With the Founder as merchant of record, §31.7 makes registration a per-Founder obligation.
4. **Accounts:** Cal.com, Tawk.to, Resend domain verification, R2 buckets (including the separate sensitive bucket), Sentry, PostHog, UptimeRobot.
5. **Contrast exception sign-off** — `docs/tech-stack-v2.md` §3.6.
6. **Named pilot monitoring and rollback owners** — §34's final requirement. Actual people.

---

## Next

Phase 1 is the first Claude Code session. Open it fresh and give it one line:

```
Read docs/phases/phase-01.md and execute it.
```
