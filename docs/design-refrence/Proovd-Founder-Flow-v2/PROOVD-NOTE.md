# Repo note — what is here, and what is not

Supplied design reference for the Founder onboarding flow. The brief built from it is
`docs/phases/founder-flow-v2.md`; `README.md` beside this file is the client's own handoff
document and is the authority on the design.

Open `Proovd Founder Flow v2.dc.html` in a browser and walk all twenty-six screens. Its
`startScreen` prop jumps straight to any of them.

## Not committed

- **`fonts/`** — licensed Satoshi binaries. `.gitignore` excludes
  `docs/design-refrence/**/fonts/` for the same reason it excludes `frontend/public/fonts/*.woff2`
  and `docs/fonts/`: they are self-hosted locally and are not ours to redistribute. The folder is
  on disk so the prototype renders in its real typeface; re-copy it from the original bundle if it
  goes missing. The product itself uses `Satoshi-Variable.woff2` (`font-weight: 300 900`), not the
  four static weights this bundle ships.

## Present but duplicated

- **`vendor/`** — GSAP core, Flip and SplitText. The same three plugins are already vendored at
  `frontend/public/vendor/gsap/`, alongside ScrollTrigger, TextPlugin and ScrambleTextPlugin. The
  copy here exists only so the prototype runs standalone. **Build against the repo's copies**,
  through `MotionProvider` — never `import gsap`, never install the package.

## About `assets/`

Roughly 40 MB of print-resolution PNGs, most of them several times larger than the size they
render at (`review-loupe.png` is 6110×2904 and displays at 1180px; `avatar.png` is a 2996×2996
avatar). The bundle's own README says these are copies and that the real brand assets should come
from our pipeline rather than from here.

They are kept at full size because a design reference is worth more unmodified than compressed,
and because nothing in the product loads them.
