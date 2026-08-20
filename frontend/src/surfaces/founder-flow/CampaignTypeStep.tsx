/**
 * Screen 4 — the campaign path. Spec §9 step 1, §33.1.7.
 *
 * REBUILT 2026-08-20 to the supplied reference (`Proovd Founder Flow v2.dc.html`,
 * `[data-kind]` / `kindWide`), from scratch rather than adjusted, on the same
 * instruction and the same precedent as `InviteClaim` (screen 1) and
 * `ConfirmAnswer` (screens 2 and 3): the presentation and the interaction are
 * the reference's own, and the read, the autosave, the address and the lock
 * rules are unchanged.
 *
 * ── This screen still locks nothing, and that is the trap ───────────────────
 * §9's lock is at SUBMISSION. What happens here is a draft answer the Back
 * button may revisit as often as the Founder likes; the database enforces the
 * permanence (the 0007 trigger) and this screen does not pretend to. Nothing
 * below writes `lockedType`, writes `typeLockedAt`, or submits.
 *
 * ── The layout model is the reference's, not an approximation of it ─────────
 * This page is not laid out responsively there. It is authored once, on a
 * fixed 2496x1542 stage, and that stage is scaled to the viewport by
 * `fitStages()`'s HERO branch — the one the invite, the reach orbit and this
 * screen share:
 *
 *     const hero = (c==='claim' || c==='reach' || c==='kind');
 *     s = Math.min(innerWidth/2497, innerHeight/1459) * 1.04;
 *
 * — divisors that are deliberately NOT the stage's own 2496x1542. The comment
 * beside them says why: "invite and choice keep their original crop; every
 * later page fits the whole stage plus a 4% margin". So this screen reads a
 * notch larger than the vetting pages that follow it, exactly as there.
 *
 * `isClaimPhone()` returns `false` in the reference — "one composition
 * everywhere: the phone posture stays off" — so its `kindPhone` branch is dead
 * code and this composition is what every viewport gets.
 *
 * ── Two stages, one route, and both are always in the DOM ───────────────────
 * Pick, then confirm. One address, because it is one decision: a bookmark to
 * the confirm stage of a choice nobody has made restores nothing.
 *
 * The two are stacked on the same centre and the inactive one is hidden with
 * `visibility:hidden;pointer-events:none` — the reference's own `confirmHide` /
 * `pickHide`, and not a conditional render. That is load-bearing rather than
 * incidental: the `Select` travel measures the pick sticker's rect, swaps the
 * stage, measures the confirm row's sticker, and inverts between them. Both
 * elements have to exist across that frame or there is nothing to measure.
 * `visibility:hidden` also takes the hidden stage out of the tab order and the
 * accessibility tree, so only the live one is reachable (§28.5).
 *
 * ── The pager IS the reference, and the earlier build's radio group is not ──
 * The previous version of this file replaced the reference's one-at-a-time
 * pager with a `Choice` radio group showing both paths side by side, on the
 * reasoning that §9 wants both explained "before it is chosen" and a pager
 * puts half of that one interaction away. The instruction for this rebuild is
 * that the reference outranks that reading, so the pager is back: two arrows,
 * one sticker, one paragraph, one `Select`.
 *
 * What the reference does NOT draw on this screen, and therefore neither does
 * this — recorded rather than quietly dropped, because each was here before:
 *
 *   - The permanence warning (`CAMPAIGN_TYPE_LOCK_WARNING`). Its register
 *     entry says it is "shown at the campaign-path step and again before
 *     submission"; the second of those is where it now renders alone. §9's
 *     rule is met at the moment the lock actually happens, which is also the
 *     only moment it is true.
 *   - The `commitments` lists — §4.1's and §4.2's five-line consequences for
 *     each path. The reference carries one sentence per type instead, and
 *     those are what render.
 *   - The wordmark, HELP, and the message badge. `[data-kind]` has one control
 *     besides its own: a `Back` at bottom-left. `.ff__top` is hidden here as
 *     it is on the invite and the two paper screens, and no badge is asked
 *     for, so both leave the tab order rather than being drawn and ignored.
 *
 * ── The two things that survive the reference's chrome, and why ─────────────
 * Both are behaviour rather than decoration, and both are `ConfirmAnswer`'s
 * own answer to the same question:
 *
 *   1. A save that FAILS says so. It is absolutely positioned so it cannot
 *      move the composition, and is a `.sr-only` live region in every state
 *      the reference actually has. §1.1 requires the failure state.
 *   2. The loading state before the record arrives. The reference has its
 *      answer in memory and never waits for one.
 *
 * ── The FLIP is hand-written, and the arithmetic is the reason ──────────────
 * `kindSelect` measures the pick sticker, `kindLand` measures the confirm
 * row's, and the delta is divided by the ancestor scale before it becomes a
 * GSAP `x`/`y` — rects are viewport pixels and `x`/`y` are local ones, and
 * inside a stage at ~0.5 an undivided delta lands short. See `anim.ts`.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router';
import { founderFlowPath } from '@proovd/shared';
import { Measure, Section, StatePanel } from '../../components/index.js';
import {
  kindExit,
  kindIntro,
  kindLand,
  kindRowPick,
  kindRowsIntro,
  kindSelect,
  kindSlide,
} from '../../components/anim.js';
import { describeSaveState } from '../../lib/autosave.js';
import { useAutosave } from '../../lib/useAutosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import {
  fetchVetting,
  saveVetting,
  type CampaignTypeValue,
  type VettingPatch,
  type VettingState,
} from '../draft/api.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

/* ── The reference's `KINDS`, in its own order ─────────────────────────────
   Its `key` is `prebuild` / `prelaunch`; the stored value is the project's
   own `pre_build` / `pre_launch` (§3), which is the one thing about this
   screen that is not the reference's. Every string below is verbatim,
   including the three ASCII periods that open `lead` and the leading space
   that opens `body` — the reference renders `<strong>{lead}</strong>{body}`
   with no space of its own between them.

   `art` is the reference's own sticker, re-encoded to webp beside screens 2
   and 3's; `height` is the pixel height it renders at on the 2496px stage,
   and the two differ there (346 against 452) because the images do. */

interface Kind {
  type: CampaignTypeValue;
  /** The confirm stage's row label. */
  row: string;
  /** `I have an Idea` needs `an`; `I have a Product` needs `a`. */
  head: string;
  lead: string;
  body: string;
  art: string;
  /** On the pick stage, and in the confirm row. */
  height: { pick: number; row: number };
}

const KINDS: readonly Kind[] = [
  {
    type: 'pre_build',
    row: 'I have an Idea',
    head: 'I’m working on an...',
    lead: '...Idea campaigns',
    body: ' are for you if you have an Idea and want to turn it into a product if you know people will pay.',
    art: '/assets/sticker-idea.webp',
    height: { pick: 346, row: 152 },
  },
  {
    type: 'pre_launch',
    row: 'I have a Product',
    head: 'I’m working on a...',
    lead: '...Product campaigns',
    body: ' are for you if you have built it already and want a founding-member pre-sale with real reward tiers.',
    art: '/assets/sticker-product.webp',
    height: { pick: 452, row: 176 },
  },
];

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()`, hero branch. The divisors are the reference's own and are
   not the stage's size — see the note at the top of this file. */

const FIT_W = 2497;
const FIT_H = 1459;
const HERO_BOOST = 1.04;

function stageScale(): number {
  return (
    Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * HERO_BOOST
  );
}

export function CampaignTypeStep() {
  const { token = '' } = useParams();
  const [loaded, setLoaded] = useState<VettingState | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchVetting(token)
      .then((state) => {
        if (!cancelled) setLoaded(state);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (unavailable) return <LinkUnavailable />;

  if (!loaded) {
    return (
      <Section>
        <Measure>
          <StatePanel
            state="Opening your campaign type"
            whatHappened="We're checking whether you have already chosen. Nothing has been submitted and nothing is locked."
            next="Your two options appear in a moment."
            owner="Proovd"
            nextUpdate="Within a few seconds"
            action="No action needed"
            reference="Your invitation link"
          />
        </Measure>
      </Section>
    );
  }

  return (
    <FlowPage pageId="campaign-type" param={token}>
      <KindScreen token={token} loaded={loaded} />
    </FlowPage>
  );
}

/**
 * The screen, and the one place its scale and its motion are owned.
 *
 * `relayIn` still runs on this page from `FlowPage` and still finds nothing to
 * do: every marker here is `data-kind-*`, not `data-anim`.
 */
function KindScreen({ token, loaded }: { token: string; loaded: VettingState }) {
  const { leave } = useFlowNav();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Pre-selected from Admin's discovery answer where there is one; the
  // Founder's own choice supersedes it and the server records which. The
  // reference has no equivalent and opens on `kindIx: 0`, which is what an
  // unanswered record gets here too.
  const initial = KINDS.findIndex((k) => k.type === loaded.selectedType);
  const [index, setIndex] = useState(initial < 0 ? 0 : initial);
  const [phase, setPhase] = useState<'pick' | 'confirm'>('pick');
  const [busy, setBusy] = useState(false);

  // The FIRST half of the manual FLIP, captured mid-swell and consumed by the
  // layout effect after the stage has swapped. A ref rather than state: it
  // must not cause a render of its own, and it is read exactly once.
  //
  // `viaSelect` is what tells the two confirm-stage entrances apart, and it is
  // separate from the rect because the rect is legitimately null when motion
  // is off — in which case `Select` still ran and `kindRowsIntro` must not.
  const flipFrom = useRef<DOMRect | null>(null);
  const viaSelect = useRef(false);
  // Which way `kindSlide` runs, set by whichever arrow was pressed.
  const slide = useRef<1 | -1>(1);

  const autosave = useAutosave<VettingPatch>(
    useCallback((patch: VettingPatch) => saveVetting(token, patch), [token]),
  );

  const kind = KINDS[index]!;

  // `fitStages`, for this screen. First, so the first paint is already at the
  // right scale — and on resize, because the reference refits there too.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      el.style.transform = `translate(-50%, -50%) scale(${stageScale()})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // The entrance, and the re-entrance. The reference runs `kindIntro` on
  // arrival AND on `Back` out of the confirm stage (`step({kindStage:'pick'},
  // 'back')` lands in `after('back')`, which calls it again), so this is keyed
  // on the phase rather than on mount.
  //
  // Arriving at `confirm` through `Select` is NOT this: `flipFrom` is set, the
  // sticker is already in flight, and `kindLand` owns the sequence. The
  // reference's own confirm-stage entrance is for the case where the rows are
  // simply the page, and that is what `kindRowsIntro` is.
  useLayoutEffect(() => {
    if (phase === 'pick') return kindIntro(root.current);
    const first = flipFrom.current;
    const selected = viaSelect.current;
    flipFrom.current = null;
    viaSelect.current = false;
    if (!selected) return kindRowsIntro(root.current);
    kindLand(root.current, index, first);
    return undefined;
    // `index` is deliberately not a dependency: paging is `kindSlide`'s, and
    // re-running the entrance for it would re-reveal the headline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Paging. Skipped on the first pass, where the entrance owns these elements.
  const firstPage = useRef(true);
  useLayoutEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    if (phase === 'pick') kindSlide(root.current, slide.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  /** `kindGo`. Wraps, exactly as there — two types and either arrow reaches
   *  the other one. It does NOT write the answer: the reference sets `type`
   *  at `Select`, at `rowPick` and at `Confirm`, and paging past a card is not
   *  choosing it. */
  function page(direction: 1 | -1) {
    if (busy) return;
    const next = (index + direction + KINDS.length) % KINDS.length;
    if (next === index) return;
    slide.current = direction;
    setIndex(next);
  }

  /** `kindSelect`. The swell commits mid-flight; the rect it hands back is the
   *  travel's starting point. */
  function select() {
    if (busy) return;
    setBusy(true);
    autosave.queue({ selectedType: kind.type });
    kindSelect(root.current, (first) => {
      flipFrom.current = first;
      viaSelect.current = true;
      setBusy(false);
      setPhase('confirm');
    });
  }

  /** `rowPick`. Changing the answer on the confirm stage. */
  function pick(next: number) {
    if (next === index) return;
    setIndex(next);
    autosave.queue({ selectedType: KINDS[next]!.type });
    // After the render that moves the outline and the fill onto the new row.
    requestAnimationFrame(() => kindRowPick(root.current, next));
  }

  /** `kindConfirmGo`. Its own 0.28s stage fade, then the next page. */
  async function confirm() {
    // Land what is chosen before moving. The reference has no server; this is
    // the one thing about the sequence that is ours.
    await autosave.flush();
    kindExit(stage.current, () => {
      void navigate(founderFlowPath('email', token));
    });
  }

  /** The reference's `onBack` for this screen: out of confirm is back to the
   *  pick stage, and out of pick is the previous page. */
  function back() {
    if (phase === 'confirm') {
      flipFrom.current = null;
      viaSelect.current = false;
      setPhase('pick');
      return;
    }
    // The reference's `if(c==='kind'){ ... this.pageGo('reach'); }` — the
    // reach orbit took this slot on 2026-08-20.
    leave(founderFlowPath('reach', token), -1);
  }

  const status = describeSaveState(autosave.state);
  const loud =
    autosave.state.status === 'failed' || autosave.state.status === 'retrying';
  const hidden = { visibility: 'hidden', pointerEvents: 'none' } as const;

  return (
    <div className="ff-kind" ref={root}>
      {/* The reference's `[data-back]`: bottom-left, uppercase, brand ink,
          with its own 11px chevron. */}
      <button type="button" className="ff-kind__back" onClick={back}>
        <svg
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 5 8 12l7 7" />
        </svg>
        Back
      </button>

      <div className="ff-kind__stage" data-page-stage="1" ref={stage}>
        {/* ── The confirm stage ────────────────────────────────────────────
            First in the DOM, exactly as there. Hidden rather than unmounted:
            the travel measures a sticker in each stage across one frame. */}
        <div
          className="ff-kind__rows"
          style={phase === 'confirm' ? undefined : hidden}
          aria-hidden={phase === 'confirm' ? undefined : true}
        >
          {KINDS.map((entry, i) => (
            <button
              key={entry.type}
              type="button"
              className="ff-kind__row"
              data-kind-row="1"
              data-chosen={i === index ? '1' : undefined}
              aria-pressed={i === index}
              tabIndex={phase === 'confirm' ? undefined : -1}
              onClick={() => pick(i)}
            >
              <img
                className="ff-kind__row-art"
                data-kind-flip-art="1"
                src={entry.art}
                alt=""
                style={{ height: entry.height.row }}
              />
              <span className="ff-kind__row-label">{entry.row}</span>
            </button>
          ))}

          <button
            type="button"
            className="ff-kind__confirm"
            data-kind-part="confirm"
            tabIndex={phase === 'confirm' ? undefined : -1}
            onClick={() => void confirm()}
          >
            Confirm
          </button>
        </div>

        {/* ── The pick stage ───────────────────────────────────────────────── */}
        <div
          className="ff-kind__pick"
          style={phase === 'pick' ? undefined : hidden}
          aria-hidden={phase === 'pick' ? undefined : true}
        >
          {/* §33.11.2: the page's own title, and it changes with the choice —
              `an...` for the Idea card, `a...` for the Product one. */}
          <h1 className="ff-kind__head" data-kind-part="head">
            {kind.head}
          </h1>

          <div className="ff-kind__art" data-kind-part="art">
            <button
              type="button"
              className="ff-kind__arrow"
              onClick={() => page(-1)}
              tabIndex={phase === 'pick' ? undefined : -1}
              /* The reference gives its arrows no accessible name at all. One
                 is added here because an unnamed control is a real defect and
                 a name is invisible — it changes nothing about the render. */
              aria-label="Show the previous campaign type"
            >
              <svg
                viewBox="0 0 24 24"
                width="53"
                height="53"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 5 8 12l7 7" />
              </svg>
            </button>

            {/* Keyed on the type, so React swaps the element rather than
                mutating one image's `src` — the arriving sticker is what
                `kindSlide` animates, and a reused node would carry the
                outgoing one's transform into it. */}
            <img
              key={kind.type}
              className="ff-kind__sticker"
              data-kind-art="1"
              src={kind.art}
              alt=""
              style={{ height: kind.height.pick }}
            />

            <button
              type="button"
              className="ff-kind__arrow"
              onClick={() => page(1)}
              tabIndex={phase === 'pick' ? undefined : -1}
              aria-label="Show the next campaign type"
            >
              <svg
                viewBox="0 0 24 24"
                width="53"
                height="53"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m9 5 7 7-7 7" />
              </svg>
            </button>
          </div>

          <p className="ff-kind__body" data-kind-part="body">
            <strong>{kind.lead}</strong>
            {kind.body}
          </p>

          <button
            type="button"
            className="ff-kind__cta"
            data-kind-part="cta"
            tabIndex={phase === 'pick' ? undefined : -1}
            onClick={select}
          >
            Select
          </button>
        </div>

        {/* Absolutely positioned under the stage, so it can never move the
            composition. Announced in every state and drawn in one. */}
        <p
          className={loud ? 'ff-kind__save is-loud' : 'ff-kind__save sr-only'}
          role="status"
          aria-live="polite"
          data-state={autosave.state.status}
        >
          {status}
        </p>
      </div>
    </div>
  );
}
