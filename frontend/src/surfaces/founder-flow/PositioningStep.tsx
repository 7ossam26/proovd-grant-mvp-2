/**
 * Screen 7 — Positioning, dictation, and the submission. Spec §9, §33.1.5.
 *
 * REBUILT 2026-08-20 to the supplied reference (`Proovd Founder Flow v2.dc.html`,
 * `[data-compet]` / `kindWide`), from scratch rather than adjusted, on the same
 * instruction and the same terms as screens 1–6 above it. The presentation and
 * the interaction are the reference's own; the record it writes, the address it
 * lives at, the submission it performs and the provenance rules are unchanged.
 *
 * ── The layout model is the reference's, not an approximation of it ─────────
 * This page is not laid out responsively there. It is authored once, on a fixed
 * 2496x1542 stage, and that stage is scaled to the viewport:
 *
 *     fitStages(){ const s = Math.min(innerWidth/2496, innerHeight/1542) * .78;
 *                  el.style.transform = 'translate(-50%,-50%) scale(' + s + ')'; }
 *
 * — `.78` is the prototype's own `pageScale` default, and like the verify
 * screen this one takes none of `fitStages`'s per-page multipliers (they are
 * for `claim`/`reach`/`kind`, `vReviewing`, `intake`, `approval`, and the two
 * paper screens). Inside that stage sits a 1660px column, centred. Every child
 * below carries the reference's own pixel value.
 *
 * Measured against the running prototype at 1440x900: scale 0.45, column
 * 747x472.4 at (339, 213.8), headline 44.9px tall, field 747x315, row 747x59.4
 * with `Say it instead` 265.5 wide, Back at (43.2, 830), the badge 74.9 square
 * at (1306.9, 785.1). Recording: the row is 286.2x118.4 at (569.4, 610.8).
 *
 * `isClaimPhone()` returns `false` in the reference — "one composition
 * everywhere: the phone posture stays off" — so its `kindPhone` branch is dead
 * code and this composition is what every viewport gets, exactly as there.
 *
 * ── This screen HAS the reference's chrome, unlike screens 1–6 ─────────────
 * `[data-compet]` draws the wordmark, HELP, the message badge and Back. So
 * `FlowPage`'s own `.ff__top` and `.ff__badge` are hidden here and the four
 * controls are drawn inside the fixed layer, exactly where the reference puts
 * them — otherwise they would sit under a `z-index: 25` sheet and be invisible.
 * HELP and the badge open the SAME drawer, which is what the reference does
 * (`onClick="{{ openHelp }}"` on both).
 *
 * The badge's `{{ mailCount }}` is `2 + max(0, vStep - 3)` there — an unread
 * count for messages this product does not have, and a number with no record
 * behind it is the §1.4 failure. It is not dropped and not invented: it is the
 * number of cards the drawer it opens will actually show, and the control's
 * accessible name says so, so it cannot read as unread mail.
 *
 * ── The one answer Proovd never writes ──────────────────────────────────────
 * §9 says it twice: "Always blank. Written by the Founder. Must never be
 * prefilled or represented as AI-generated." Four independent mechanisms hold
 * it — there are no `competition_prefilled_*` columns to read a draft from, a
 * CHECK pins `competition_supplier` to `founder`, `VETTING_STEPS`' own
 * `prefillable: false` records the same fact where the copy lives, and §33.1.5
 * scans the tree for a fourth way in. Nothing on this screen could prefill it
 * if it tried, and there is deliberately no "suggest" affordance beside the
 * microphone — which is the form the temptation actually takes once a
 * transcription vendor is in the tree.
 *
 * ── Dictation: the reference's picture, this product's recorder ────────────
 * Founder Flow v2 deviation 2. Every part of the reference's recording state
 * is reproduced — the handoff where `Next` collapses as the microphone takes
 * the row, the tinted field, `LISTENING — 0:07` at the field's bottom-right,
 * the 72-bar waveform drawing itself up from the centre, and Pause / Done /
 * Retry at 176, 196 and 176 square.
 *
 * The words arrive WHILE somebody is speaking, as they do there. The reference
 * simulates it — `runDict` types a canned sentence into the box a word every
 * 120ms — and this does it for real, through `./speech.ts`, which is the
 * browser's own `SpeechRecognition`. The transcription port cannot produce that
 * shape: it takes a finished recording and answers once, so the field would sit
 * empty for the whole recording and every word would land in one lump at the
 * end. Both engines are here and the live one is preferred:
 *
 *     speech  — live words, `Done` keeps them, no `working` state
 *     port    — one recording, one answer, `working` while it is in flight
 *
 * The port is not replaced. It is what a browser with no speech recognition
 * uses, and it is still what Story's `Dictation` uses through its own route.
 * Which engine ran is invisible to the record: both write ordinary editable
 * Founder text into the same box through the same autosave.
 *
 * **The microphone is offered whenever EITHER engine can run.** It used to be
 * offered only when the port was configured, which on this deployment (Track
 * A4) meant never — the whole recording state, the waveform and the three
 * controls were unreachable code behind a button that did not render.
 *
 * `Retry` matches the reference now, correctly scoped. There it clears the
 * answer (`ans[id]={...,text:''}`) because there the whole answer came from
 * dictation. Here it restores what the box held when the recording STARTED, so
 * it throws away exactly the words this recording added and never a word the
 * Founder typed. A control that silently deleted a typed answer would be the
 * worst thing on this screen.
 *
 * The recording is never kept — no column, no bucket key, no job — and the
 * transcript lands in this textarea as ordinary editable Founder text with
 * supplier `founder`, saved through the same autosave typing uses. That is what
 * keeps §9's "never represented as AI-generated" true: nothing generated it, a
 * machine typed what was said.
 *
 * ── Next submits, which is where the campaign type locks ───────────────────
 * The reference's `competNext` advances a step. Ours submits the whole vetting
 * record, and §9's type lock happens there and is permanent.
 *
 * **It is never a silent no-op** (fixed 2026-08-20, from a real report that the
 * control "does nothing"). It was `disabled` while the box was empty or while
 * an earlier §9 answer was, and this screen's `:disabled` renders identically
 * to the live button — so the whole failure was invisible. Both guards survive
 * and both now speak: an empty box says so and takes the caret, and an empty
 * earlier answer sends somebody to the screen that owns it, because §9 submits
 * all three at once and that is the only direction that still moves. See
 * `submit()`.
 *
 * `CAMPAIGN_TYPE_LOCK_WARNING` was rendered here and is NOT any more, removed
 * on explicit product direction (2026-08-20) — the reference draws no such line
 * and the screen was asked to match it. Recorded rather than quietly dropped,
 * because it leaves a real gap: screen 4's own rebuild removed the warning on
 * the reasoning that this screen was "the only moment it is true", so with both
 * gone the flow states the permanence of the campaign-type lock nowhere. The
 * rule itself is untouched — the lock is still a database trigger and still
 * fires at submission — and the constant is still exported and still asserted
 * by `founder-flow-v2.test.ts`. What is missing is a Founder being told.
 *
 * The dictation-unavailable sentence went with it, on the same instruction —
 * and it is no longer the sentence it was: with the live engine in place the
 * microphone renders on this deployment, and the only browser that sees the
 * row as `Next` alone is one with neither engine. It says nothing about why,
 * which is the standing cost of that instruction rather than a new one.
 *
 * There is no global Enter handler. The reference binds one
 * (`enterAdvance`), and it is already inert whenever focus is in the textarea —
 * which is where focus is on this screen. What it would add is a keystroke that
 * submits and permanently locks a campaign type from anywhere on the page, and
 * §30 forbids a competing action in exactly this class of state.
 *
 * ── It does NOT re-ask Problem or Solution ──────────────────────────────────
 * The reference asks both twice: screens 2–3, then again at 7–8, whose own help
 * card calls it "last look at the problem and the solution". §9 has one
 * `problem_text` and one `solution_text`, and screens 2–3 are those two answers.
 * A record collected in two places is a record whose two copies eventually
 * disagree. What this screen does instead is name a missing earlier answer and
 * link back to the page that owns it.
 *
 * ── The typed value never comes back from the server ────────────────────────
 * `useAutosave` reports an outcome and returns nothing, deliberately: the
 * caller's state is the only copy of what was typed, and that one decision is
 * the whole autosave bug class (§9: "a failed save never clears valid fields").
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useParams } from 'react-router';
import {
  VETTING_STEPS,
  founderFlowIndex,
  founderFlowPage,
  founderFlowPath,
} from '@proovd/shared';
import { SurfaceLoading } from '../../features/public/states.js';
import { recIntro, sayHandoff, stageRelayIn } from '../../components/anim.js';
import { describeSaveState } from '../../lib/autosave.js';
import { useAutosave } from '../../lib/useAutosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import {
  DraftRequestError,
  fetchVetting,
  saveVetting,
  submitVetting,
  transcribeAudio,
  type VettingPatch,
  type VettingState,
} from '../draft/api.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { speechSupported, startSpeech, type SpeechSession } from './speech.js';

const STEP = VETTING_STEPS.find((step) => step.id === 'competition')!;

/** The two answers this screen depends on, and the page that owns each. */
const EARLIER = [
  { key: 'problem' as const, pageId: 'problem' },
  { key: 'solution' as const, pageId: 'solution' },
];

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()` for a page it treats as ordinary: the stage's own size as the
   divisors and `pageScale` alone, exactly as the verify screen takes it. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;

function stageScale(): number {
  return (
    Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE
  );
}

/**
 * The reference's own relay order for this screen, out of `verifyIntro`'s fixed
 * list `pill, head, field, boxes, note, fee, sub, hint, panel, art, art2, cta,
 * edit`. Passed to `stageRelayIn` rather than read from the DOM, because the
 * 0.085s stagger follows THIS order and not document order.
 */
const RELAY = ['head', 'panel', 'cta'] as const;

/**
 * The waveform, reproduced exactly:
 *
 *     cWave: Array.from({length:72},(_,i)=>({h:(18+Math.round(
 *              Math.abs(Math.sin(i*1.7)*Math.cos(i*.6))*78))+'%'}))
 *
 * Deterministic rather than random, which is the reference's own choice and the
 * right one twice over: the same run draws the same picture, and the bars are a
 * decoration for a recording rather than a reading of one. Computed once at
 * module load, as its `this._wave ||=` memo does.
 */
const WAVE: readonly string[] = Array.from(
  { length: 72 },
  (_, i) =>
    18 + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)) * 78) + '%',
);

/** `cTime`, verbatim: `Math.floor(s/60)+':'+String(s%60).padStart(2,'0')`. */
function clock(seconds: number): string {
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

/**
 * A server refusal, said in full.
 *
 * The three parts are three different facts and only the last two are any use:
 * the title names the act that failed, `whatHappened` says why, and `next` says
 * what to do about it — §27.1's first two questions and its fifth. Rendering
 * the title alone is how a screen comes to report `That was not submitted` at
 * somebody while holding the sentence that would have unstuck them.
 */
function refusalText(error: unknown): string {
  const fallback = 'That did not go through. Everything you have written is saved.';
  if (!(error instanceof DraftRequestError)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }
  const parts = [
    error.detail.title,
    error.detail.whatHappened,
    error.detail.next,
  ].filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  return parts.length ? parts.join(' ') : fallback;
}

export function PositioningStep() {
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
  if (!loaded) return <SurfaceLoading subject="your answers" reference="Your invitation link" />;

  return (
    <FlowPage pageId="positioning" param={token}>
      <CompetScreen token={token} loaded={loaded} />
    </FlowPage>
  );
}

/** Where the recorder is. `arming` keeps the say-row on screen while the
 *  browser asks for the microphone, so the handoff and the permission prompt
 *  can run at the same time without either waiting for the other.
 *
 *  `working` belongs to the port engine alone — it is the wait while a finished
 *  recording is transcribed. The live engine has already written the words by
 *  the time `Done` is pressed, so it goes straight back to `idle`. */
type Phase = 'idle' | 'arming' | 'live' | 'paused' | 'working';

/**
 * Which of the two dictation engines a recording is running on.
 *
 *  `speech` — the browser's own recognition. Words arrive while somebody
 *             speaks, which is the reference's behaviour.
 *  `port`   — `POST /transcribe`. One recording in, one transcript out.
 *
 * Chosen per recording rather than once for the page, so a browser that has
 * both keeps the live one and a browser that has neither never shows the
 * microphone at all.
 */
type Engine = 'speech' | 'port';

/** What a refusal sounds like to somebody who has just pressed record. Every
 *  one of them ends the same way, because the answer is always the same: the
 *  box below is still there and still theirs. */
const REFUSAL: Record<string, string> = {
  denied:
    'Your browser blocked the microphone, so nothing was recorded. Allow it in the address bar to try again — or type your answer instead, it is the same box either way.',
  no_microphone:
    'We could not reach a microphone, so nothing was recorded. Type your answer instead — it is the same box either way.',
  unavailable:
    'Dictation stopped and nothing more was recorded. Anything already written down is still there — carry on typing, it is the same box either way.',
};

function CompetScreen({ token, loaded }: { token: string; loaded: VettingState }) {
  const { leave } = useFlowNav();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  /** The first empty earlier answer's link — where `Next` puts focus. */
  const missingLink = useRef<HTMLAnchorElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  const [answer, setAnswer] = useState(loaded.competition ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  /** Bumped whenever the say-row must come back with no GSAP left on it. */
  const [attempt, setAttempt] = useState(0);
  /** Bumped for each recording, so `recIntro` runs once per session and not on
   *  every pause. */
  const [session, setSession] = useState(0);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  /**
   * The live recorder, and whether the audio it is holding is wanted.
   *
   * `drop` lives on the SESSION rather than in a ref of its own, and that is a
   * real bug fixed rather than a preference: `MediaRecorder.stop()` fires
   * `onstop` as a task, and `retry` schedules the next recording on the very
   * next frame. With one shared flag the new session could clear it before the
   * old session's `onstop` had read it — and the recording a person had just
   * discarded would be transcribed and appended anyway, which is the exact
   * opposite of what they pressed. Each `onstop` closes over its own object.
   */
  const recorder = useRef<{ media: MediaRecorder; drop: boolean } | null>(null);
  const chunks = useRef<Blob[]>([]);

  /** The live engine's session, and the text the box held when it began.
   *
   *  `base` is what makes `Retry` exact. `speech.ts` reports everything heard
   *  so far rather than a delta, so the box is always `base + heard` — and
   *  throwing a recording away is writing `base` back, which cannot take a
   *  word the Founder typed with it. */
  const speech = useRef<SpeechSession | null>(null);
  const base = useRef('');
  const engine = useRef<Engine>('speech');

  /** Decided once. A browser does not grow the API mid-session, and asking on
   *  every render would run a `window` lookup inside the recording loop. */
  const [speechReady] = useState(speechSupported);

  /**
   * Whether the microphone permission is ALREADY granted, asked once on mount.
   *
   * It decides how long the handoff waits, and both answers are right for their
   * own case. Granted: the microphone opens in a few tens of milliseconds, so
   * the controls appear the instant the animation ends — the reference's own
   * timing, with no dead beat. Not granted (or unknown): a permission prompt is
   * about to appear and may sit there for as long as somebody takes to read it,
   * so the controls wait for the microphone to actually open. `LISTENING —
   * 0:04` counting up behind an unanswered dialogue box would be the §1.4
   * failure on the one line whose whole job is to say what is happening.
   */
  const granted = useRef(false);
  useEffect(() => {
    const permissions = navigator.permissions as Permissions | undefined;
    if (!permissions?.query) return;
    let cancelled = false;
    permissions
      // `microphone` is not in the standard `PermissionName` union, and asking
      // for it throws on a browser that does not know it — hence both the cast
      // and the catch.
      .query({ name: 'microphone' as PermissionName })
      .then((result) => {
        if (cancelled) return;
        granted.current = result.state === 'granted';
        result.onchange = () => {
          granted.current = result.state === 'granted';
        };
      })
      .catch(() => {
        // Unknowable here. Treated as not granted, which waits — the safe side.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  /** The live answer, for the recorder callbacks, which close over their own
   *  render's `answer` otherwise and would append onto a stale copy. */
  const latest = useRef(answer);
  latest.current = answer;

  const autosave = useAutosave<VettingPatch>(
    useCallback((patch: VettingPatch) => saveVetting(token, patch), [token]),
  );

  // `fitStages`, for this page. First, so the first paint is already at the
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

  useLayoutEffect(() => stageRelayIn(root.current, direction.current ?? 1, RELAY), []);

  // The recording controls and the waveform announce themselves — once per
  // recording, after the row has mounted — and the waveform then stays alive
  // until the row goes. The teardown is what stops an infinite tween outliving
  // its element.
  useLayoutEffect(() => {
    if (session === 0) return;
    return recIntro(root.current);
  }, [session]);

  // `tickSecs`: one second at a time, and a pause holds the number where it is.
  useEffect(() => {
    if (phase !== 'live') return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // Nothing keeps a microphone open past this page — on either engine.
  useEffect(() => {
    return () => {
      recorder.current?.media.stream.getTracks().forEach((track) => track.stop());
      recorder.current = null;
      speech.current?.abandon();
      speech.current = null;
    };
  }, []);

  const status = describeSaveState(autosave.state);
  const missing = EARLIER.filter((entry) => !loaded.completeness[entry.key]);
  /**
   * The first earlier answer that is still empty, if any.
   *
   * §9 submits all three together and `submitVetting` refuses a short set by
   * name, so while one of these is empty there is nothing this screen can
   * submit — and the one direction that still carries the flow forward is the
   * screen that owns the empty one. `Next` goes there.
   */
  const nextMissing = missing[0] ?? null;
  const dictation = loaded.transcription;
  /** The port, as the vetting read reports it. Absent means an older payload,
   *  which is treated as configured — the request is the thing that decides. */
  const portReady = !dictation || dictation.available;
  /** The microphone is offered when EITHER engine can run. Gating it on the
   *  port alone hid the entire recording state on every deployment where
   *  transcription is unconfigured, which is this one. */
  const canDictate = speechReady || portReady;
  const recording = phase === 'live' || phase === 'paused';

  function change(next: string) {
    setAnswer(next);
    autosave.queue({ competition: next });
  }

  /**
   * `change`, plus the two things dictation needs on top of typing.
   *
   * The caller's own copy of the answer moves with it, because a recognition
   * callback runs BETWEEN renders and `latest` is assigned during one — without
   * this the next word would be appended onto a copy one word old. And the box
   * scrolls to the newest words, which is the reference's own
   * `ta.scrollTop = ta.scrollHeight` after every `runDict` tick.
   *
   * Every keystroke of it goes through the same 700ms autosave typing uses, so
   * a fast talker produces one save rather than one per word.
   */
  function write(next: string) {
    latest.current = next;
    change(next);
    window.requestAnimationFrame(() => {
      const el = field.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  /** The port's transcript lands as ordinary text at the end of what is already
   *  there. The live engine writes through `write` directly, because it is
   *  replacing its own tail rather than adding to the end. */
  function append(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const head = latest.current.trimEnd();
    write(head ? head + ' ' + trimmed : trimmed);
  }

  /** `sayHandoff` — the animation runs and the microphone is asked for at the
   *  same time, and the recording starts only when both have landed. */
  /** The click. Guards on the phase, then hands off to `beginHandoff`. */
  function say() {
    if (phase !== 'idle' || !canDictate) return;
    beginHandoff();
  }

  /**
   * The handoff and the recording, with NO phase guard.
   *
   * `retry` restarts from inside a render whose `phase` is still `live`, so a
   * guard here would read that stale value and silently do nothing — which is
   * exactly what it did before this was split out: Retry stopped the recording
   * and left the idle row sitting there. The guard belongs to the click, which
   * is the only place a person can start a second recorder by accident.
   */
  function beginHandoff() {
    setAlert(null);
    setPhase('arming');
    base.current = latest.current;
    engine.current = speechReady ? 'speech' : 'port';
    if (engine.current === 'speech') {
      // The engine starts NOW, not at the end of the handoff.
      //
      // Opening a microphone takes real time — permission, device init, the
      // service handshake — and starting it in the animation's completion
      // callback put all of that AFTER the 0.38s handoff. The say-row had
      // already faded and the controls had not arrived, so there was a visible
      // blank beat of about a second with nothing on the screen at all. This is
      // the port engine's own `acquire()`-in-parallel arrangement, which was
      // written for exactly this and which the live path had not inherited.
      //
      // The controls then appear when BOTH have landed, which on any use after
      // the first is the instant the animation ends.
      const armed = startLiveRun();
      if (armed) sayHandoff(root.current, armed);
      return;
    }
    startPortRun();
  }

  /** Back to the say-row with nothing left over.
   *
   *  The row is invisible and half-collapsed under GSAP's inline styles by the
   *  time any of this runs, so it comes back as a NEW element — `key={attempt}`
   *  — rather than being cleaned up in place. Nothing survives to disagree. */
  function toIdle() {
    setAttempt((n) => n + 1);
    setPhase('idle');
  }

  /** The recording state proper: the row, the waveform, and the timer from 0. */
  function enterRecording() {
    setSeconds(0);
    setSession((n) => n + 1);
    setPhase('live');
  }

  /**
   * The live engine. The reference's own experience: words appear in the box
   * while somebody is speaking.
   *
   * `heard` is everything this session has produced, never a delta, so the box
   * is always `base + heard` and a dropped callback cannot lose a word.
   */
  function startLiveRun(replayHandoff = true): (() => void) | null {
    /**
     * Two signals have to land before the recording state appears, and neither
     * one alone is right.
     *
     * On the animation alone, the controls arrive over a microphone that may
     * still be opening and the clock counts seconds nobody recorded. On the
     * microphone alone they can arrive mid-handoff, while the say-row is still
     * collapsing. So: whichever is second.
     *
     * The engine also ends its own run after a stretch of silence and starts
     * again, so `onListening` fires more than once per recording — `entered`
     * is what stops the second one restarting the clock mid-sentence.
     */
    let animated = false;
    // Already granted means the microphone is a formality: do not make the
    // screen wait on it. See `granted` above for why the other case does.
    let open = granted.current;
    let entered = false;
    let fallback = 0;

    const enter = () => {
      if (entered || !animated || !open || !mine()) return;
      entered = true;
      window.clearTimeout(fallback);
      enterRecording();
    };

    /**
     * Every callback below asks whether it is still the LIVE session first.
     *
     * `Retry` abandons this one and starts the next on the very next frame, and
     * `abort` fires `onend` as a task — so without this the ending of the
     * recording somebody just discarded would arrive after its replacement had
     * begun and send the screen back to idle. It is the port engine's own
     * per-session `drop` flag, in the shape this API needs.
     */
    let self: SpeechSession | null = null;
    const mine = () => self !== null && speech.current === self;

    const session = startSpeech({
      onListening: () => {
        open = true;
        enter();
      },
      onText: (heard) => {
        if (!mine()) return;
        const next = heard ? (base.current ? base.current + ' ' + heard : heard) : base.current;
        write(next);
      },
      onRefused: (reason) => {
        if (!mine()) return;
        speech.current = null;
        toIdle();
        setAlert(REFUSAL[reason] ?? REFUSAL.unavailable!);
      },
      onEnded: () => {
        if (!mine()) return;
        speech.current = null;
        toIdle();
      },
    });

    if (!session) {
      // The API vanished between the check and the click. The port is the only
      // thing left, and if it is not configured either there is nothing to run.
      if (portReady) {
        engine.current = 'port';
        startPortRun(replayHandoff);
        return null;
      }
      toIdle();
      setAlert(REFUSAL.unavailable!);
      return null;
    }
    self = session;
    speech.current = session;

    // Handed to `sayHandoff` as its completion callback.
    return () => {
      animated = true;
      enter();
      // A browser that never reports the microphone opening must not leave
      // somebody on a blank screen. Long enough that it never pre-empts a real
      // `audiostart`, short enough that nobody sits waiting on it.
      fallback = window.setTimeout(() => {
        if (entered || !mine()) return;
        open = true;
        enter();
      }, 1200);
    };
  }

  /**
   * The port engine — one recording, one transcript, and a `working` wait in
   * between. Unchanged in every particular; it is now the fallback rather than
   * the only path.
   */
  function startPortRun(replayHandoff = true) {
    // The tween is created BEFORE the microphone is asked for, and the order is
    // load-bearing rather than tidy: `getUserMedia` can hold the main thread for
    // tens of milliseconds, and measured against the prototype frame by frame
    // that put the whole handoff ~85ms late — the mic had barely started
    // widening at 87ms where the reference was already a third of the way. A
    // time-based tween created first absorbs the same block by arriving at the
    // right progress on its first painted frame instead.
    //
    // `acquire` is memoised because `sayHandoff` calls back SYNCHRONOUSLY when
    // motion is off, which is before the line below it has run.
    let pending: Promise<MediaStream | null> | null = null;
    const acquire = () => {
      pending ??= navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream): MediaStream | null => stream)
        .catch(() => null);
      return pending;
    };

    const start = () => {
      void acquire().then((stream) => {
        if (!stream) {
          toIdle();
          setAlert(REFUSAL.denied!);
          return;
        }
        const media = new MediaRecorder(stream);
        const session = { media, drop: false };
        chunks.current = [];
        media.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.current.push(event.data);
        };
        media.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          const parts = chunks.current;
          chunks.current = [];
          if (recorder.current === session) recorder.current = null;
          if (session.drop) return;
          const blob = new Blob(parts, { type: media.mimeType || 'audio/webm' });
          setPhase('working');
          void transcribeAudio(token, blob)
            .then(({ text }) => append(text))
            .catch(() =>
              setAlert(
                'We could not turn that recording into words, so nothing was added. Type your answer instead — it is the same box either way.',
              ),
            )
            .finally(toIdle);
        };
        recorder.current = session;
        media.start();
        enterRecording();
      });
    };

    if (replayHandoff) {
      sayHandoff(root.current, start);

      // …and asked for immediately after, so the prompt and the 0.38s handoff run
      // at the same time rather than one after the other. On a second visit the
      // permission is already granted and the stream is there before the mic has
      // finished widening, which is the reference's own instant handoff.
      void acquire();
    } else {
      start();
    }
  }

  /**
   * `cPauseToggle`. The engine itself pauses, so what the screen says and what
   * the microphone is doing cannot come apart — the reference's `pauseDict`
   * clears the word timer rather than only relabelling the button.
   *
   * The seconds follow `phase` (`tickSecs` ignores anything but `live`), and
   * the waveform deliberately does NOT stop: `pauseDict` sets the flag and
   * re-binds, and `loops()`' own `el.__l` guard leaves the running tweens
   * alone. A still waveform over a paused recording would be a second way of
   * saying the same thing, and the reference says it once, in the label.
   */
  function pauseToggle() {
    if (engine.current === 'speech') {
      const session = speech.current;
      if (!session) return;
      if (phase === 'live') {
        session.pause();
        setPhase('paused');
      } else if (phase === 'paused') {
        session.resume();
        setPhase('live');
      }
      return;
    }
    const media = recorder.current?.media;
    if (!media) return;
    if (phase === 'live') {
      media.pause();
      setPhase('paused');
    } else if (phase === 'paused') {
      media.resume();
      setPhase('live');
    }
  }

  /** `cDone`. On the live engine the words are already in the box, so this only
   *  stops listening. On the port it starts the one round trip. */
  function done() {
    if (engine.current === 'speech') {
      speech.current?.stop();
      return;
    }
    const session = recorder.current;
    if (!session) return;
    session.drop = false;
    session.media.stop();
  }

  /**
   * `cRetry` — this recording is thrown away and a new one begins.
   *
   * The reference clears the whole answer (`ans[id]={...,text:''}`) because
   * there the whole answer came from dictation. Here it restores what the box
   * held when this recording STARTED, which is the same thing scoped correctly:
   * every word this recording put in goes, and no word the Founder typed does.
   */
  function retry() {
    setAlert(null);
    if (engine.current === 'speech') {
      speech.current?.abandon();
      speech.current = null;
      write(base.current);
      const armed = startLiveRun(false);
      // Retry in the reference calls startDict directly. The recording row
      // never disappears and the microphone handoff never plays a second time;
      // only enterRecording's recIntro is replayed for the fresh session.
      armed?.();
    } else {
      const session = recorder.current;
      if (session) {
        session.drop = true;
        session.media.stop();
      }
      recorder.current = null;
      startPortRun(false);
    }
    setSeconds(0);
  }

  /**
   * `Next`, and it always answers.
   *
   * It used to be `disabled` whenever the box was empty or an earlier answer
   * was, and `.ff-compet__next:disabled` renders identically to the live
   * control — full brand fill, full opacity, only the cursor differs. So a
   * Founder pressed a button that looked exactly as pressable as it ever does
   * and NOTHING happened: §27.1's "what can I do now", answered by a control
   * that does not respond, with the reason 11 stage-scaled pixels below it.
   *
   * The guards are right and the silence was not, so each refusal is said out
   * loud where the control is instead of being expressed as an inert button:
   *
   *   nothing typed here    say so, and put the caret in the box
   *   an earlier answer     §9 submits all three together, so the way forward
   *     still empty         is the screen that owns the empty one. Next goes
   *                         there rather than nowhere.
   *
   * `busy` stays a real `disabled`, because it is the one state where a second
   * press would do something wrong rather than nothing — and it lasts as long
   * as one request.
   *
   * The server re-decides both regardless (§1.1): `submitVetting` refuses a
   * short answer set by name, and that refusal is what a Founder reads if this
   * screen's own copy of the question is ever wrong.
   */
  async function submit() {
    if (busy) return;

    if (!answer.trim()) {
      setAlert(
        'Write your positioning first — who else solves this, and why somebody would choose you. Next submits all your answers once it is here.',
      );
      field.current?.focus();
      return;
    }

    if (nextMissing) {
      /*
        Answered by moving focus to the link that resolves it — not by
        navigating, and not by a second paragraph.

        It used to `leave` for the page owning the empty answer, and that closed
        a ring: problem → solution → reach → campaign type → email → code → the
        two confirms → positioning → back to problem, round for as long as
        somebody kept pressing Next, and `visuals` was never reached.

        The first correction stated the refusal in an alert of its own, and a
        Founder reported the result: two messages saying the same thing, because
        the list below the column already names every empty answer and is
        rendered before Next is ever pressed. So that list is the one message —
        it says what it blocks — and Next puts the caret on the way out of it.
        Announced to a screen reader, visible to everybody else.
      */
      missingLink.current?.focus();
      return;
    }

    setBusy(true);
    setAlert(null);
    try {
      await autosave.flush();
      const result = await submitVetting(token);
      if (result.submittedAt) {
        // The old token-addressed match/claim result pair left this part of
        // the flow on 2026-08-20, so submission goes straight on to the first
        // campaign-addressed page. The new Match route comes later, after Details.
        // The submit response carries the campaign id for exactly this hop.
        leave(founderFlowPath('visuals', result.campaignId), 1);
        return;
      }
      setAlert('That did not go through. Everything you have written is saved.');
    } catch (error) {
      // The server re-decides what the screen decided, and its refusal is what
      // a Founder reads (§1.1). It names the answer or the path that is
      // missing; nothing here paraphrases it.
      //
      // `error.message` is only the TITLE — `That was not submitted` — and the
      // title is the one part that says nothing. The server had already
      // answered "You have not chosen a campaign path yet" and "Go back and
      // pick…" and both were being dropped on the floor, which left somebody
      // pressing a button that failed for a reason the product knew and would
      // not tell them (§27.1: what happened, and what next).
      setAlert(refusalText(error));
    } finally {
      setBusy(false);
    }
  }

  // The drawer's own card count — the number the badge shows, and the only
  // number on this page that is a count of something real.
  const cards = Math.max(0, founderFlowIndex('positioning') + 1);

  return (
    <div className="ff-compet" ref={root}>
      {/* The reference's own control, bottom-left. Its label names where it
          goes only to a screen reader: the visible word is its own `Back`, and
          §33.11.4's objectless-CTA rule is answered by the accessible name
          rather than by overriding the reference's copy. */}
      <button
        type="button"
        className="ff-compet__back"
        aria-label="Back to Confirm the solution"
        onClick={() => leave(founderFlowPath('confirm-solution', token), -1)}
      >
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

      <div className="ff-compet__top">
        {/* Not a link. A draft address is not a site, and the way out of a
            Founder's own half-finished form should not be the brand. */}
        <img className="ff-compet__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="positioning"
          param={token}
          trigger={
            <button type="button" className="ff-compet__help">
              Help
            </button>
          }
        />
      </div>

      <HelpDrawer
        pageId="positioning"
        param={token}
        trigger={
          <button
            type="button"
            className="ff-compet__badge"
            aria-label={`Help — ${cards} pages you have answered so far`}
          >
            <span className="ff-compet__bell">
              <img src="/assets/mail.webp" alt="" />
              <span className="ff-compet__count" aria-hidden="true">
                {cards}
              </span>
            </span>
          </button>
        }
      />

      <div className="ff-compet__stage" data-page-stage="1" ref={stage}>
        <div className="ff-compet__col">
          <h1 className="ff-compet__head" data-stage-anim="head">
            Lets talk about your competitors...
          </h1>

          <div className="ff-compet__panel" data-stage-anim="panel" data-rec={recording ? 'on' : undefined}>
            <textarea
              className="ff-compet__field"
              data-slim-scroll="1"
              ref={field}
              // A 315px box with no label is unusable with a screen reader, and
              // an `aria-label` renders nothing. The reference gives it none.
              aria-label={STEP.title}
              placeholder="My direct competitors are x, y, z. My indirect competitors are 1, 2, 3."
              value={answer}
              onChange={(event) => change(event.target.value)}
            />

            {recording ? (
              <div className="ff-compet__overlay" aria-hidden="true">
                <span className="ff-compet__fade" />
                <span className="ff-compet__meter">
                  <span className="ff-compet__level">
                    {phase === 'paused' ? 'PAUSED' : 'LISTENING'} — {clock(seconds)}
                  </span>
                </span>
                <span className="ff-compet__wave">
                  {WAVE.map((height, index) => (
                    <span
                      key={index}
                      data-wave="1"
                      className="ff-compet__bar"
                      style={{ height }}
                    />
                  ))}
                </span>
              </div>
            ) : null}
          </div>

          {recording ? (
            <div className="ff-compet__rec" data-stage-anim="cta" data-rec-row="1">
              <span className="ff-compet__ctl">
                <button type="button" className="ff-compet__ghost" onClick={pauseToggle}>
                  {phase === 'paused' ? (
                    <svg viewBox="0 0 24 24" width="82" height="82" fill="currentColor" aria-hidden="true">
                      <path d="M8 5l11 7-11 7z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="82" height="82" fill="currentColor" aria-hidden="true">
                      <rect x="6" y="5" width="4" height="14" />
                      <rect x="14" y="5" width="4" height="14" />
                    </svg>
                  )}
                </button>
                <span className="ff-compet__ctl-label">
                  {phase === 'paused' ? 'Resume' : 'Pause'}
                </span>
              </span>

              <span className="ff-compet__ctl">
                <button type="button" className="ff-compet__done" onClick={done}>
                  <svg viewBox="0 0 64 54" width="96" height="81" fill="currentColor" aria-hidden="true">
                    <path d="M51.831 0L63.176 11.345L21.3447 53.2301L0 31.2893L9.19771 22.8065L21.3447 34.053L51.831 0Z" />
                  </svg>
                </button>
                <span className="ff-compet__ctl-label">Done</span>
              </span>

              <span className="ff-compet__ctl">
                <button type="button" className="ff-compet__ghost is-retry" onClick={retry}>
                  <svg
                    viewBox="0 0 24 24"
                    width="82"
                    height="82"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M20 11A8 8 0 1 0 12 20h8" />
                    <polyline points="16 16 20 20 16 24" />
                  </svg>
                </button>
                <span className="ff-compet__ctl-label">Retry</span>
              </span>
            </div>
          ) : (
            <div
              className="ff-compet__row"
              data-stage-anim="cta"
              data-say-row="1"
              key={attempt}
            >
              {canDictate ? (
                <button
                  type="button"
                  className="ff-compet__say"
                  data-say-btn="1"
                  disabled={phase !== 'idle'}
                  onClick={say}
                >
                  <svg viewBox="0 0 30 45" width="42.667" height="64" fill="currentColor" aria-hidden="true">
                    <path d="M6.79727 27.9484C7.04159 29.9814 8.96996 31.6481 11.0729 31.6481H18.734C20.8369 31.6481 22.7653 29.9814 23.0096 27.9484L24.0305 19.5194C24.2748 17.4863 24.2748 14.1618 24.0305 12.12L23.0096 3.69096C22.7565 1.65788 20.8282 0 18.7253 0H11.0641C8.96124 0 7.03286 1.66661 6.78854 3.69969L5.77636 12.12C5.53204 14.1531 5.53204 17.4863 5.77636 19.5194L6.79727 27.9484ZM29.7807 14.8947H26.0636C26.0985 16.5963 26.0374 18.4025 25.8716 19.7462L24.8507 28.1752C24.493 31.1681 21.8054 33.5066 18.7253 33.5066H11.0641C7.99269 33.5066 5.30517 31.1594 4.9387 28.1752L3.91779 19.7462C3.752 18.4025 3.69092 16.5963 3.72583 14.8947H0.0086857C-0.026217 16.7533 0.0435885 18.6991 0.226828 20.1912L1.24773 28.6202C1.83235 33.4455 6.14284 37.2238 11.0641 37.2238H13.0361V40.9496H7.45169V44.6755H22.3464V40.9496H16.762V37.2238H18.734C23.664 37.2238 27.9745 33.4368 28.5504 28.6115L29.5713 20.1738C29.7458 18.6904 29.8156 16.7446 29.7807 14.8947Z" />
                  </svg>
                  {phase === 'working' ? 'Working…' : 'Say it instead'}
                </button>
              ) : null}

              <button
                type="button"
                className="ff-compet__next"
                data-say-next="1"
                aria-label="Next — submit your answers and continue to campaign visuals"
                disabled={busy}
                onClick={() => void submit()}
              >
                Next
              </button>
            </div>
          )}

          {/* Absolutely positioned below the column, so nothing here can move
              the composition by a pixel. The reference has none of it, and each
              line is behaviour rather than decoration: the failure state §1.1
              requires, the missing earlier answer this screen depends on, and
              the one permanent consequence of the control above it. */}
          <div className="ff-compet__sub">
            <p
              className="ff-compet__status"
              role="status"
              aria-live="polite"
              data-state={
                phase === 'working'
                  ? 'working'
                  : autosave.state.status === 'failed'
                    ? 'failed'
                    : 'quiet'
              }
            >
              {/* The failure's own reason is `describeSaveState`'s job now —
                  it was fixed there rather than here, because all twelve
                  autosaving surfaces were dropping it. */}
              {phase === 'working'
                ? 'Turning your recording into words. Nothing is written for you, and the recording is not kept.'
                : status}
            </p>

            {alert ? (
              <p className="ff-compet__alert" role="alert">
                {alert}
              </p>
            ) : null}

            {missing.length > 0 ? (
              /* The one message about this, and it says what it BLOCKS rather
                 than only what is missing — Next has nothing else to add.
                 `?from=positioning` is the return contract: filling the answer
                 comes straight back here instead of walking the seven screens
                 between them, one of which mints a new six-digit code. */
              <p className="ff-compet__alert" role="alert">
                One earlier answer is still empty:{' '}
                {missing.map((entry, index) => {
                  const page = founderFlowPage(entry.pageId);
                  return (
                    <span key={entry.key}>
                      {index > 0 ? ', ' : null}
                      <a
                        ref={index === 0 ? missingLink : undefined}
                        href={`${founderFlowPath(entry.pageId, token)}?from=positioning`}
                      >
                        {page?.title ?? entry.pageId}
                      </a>
                    </span>
                  );
                })}
                . Your three answers are submitted together, so Next cannot go
                until it is filled in — it brings you straight back here, and
                everything you have written is saved.
              </p>
            ) : null}

          </div>
        </div>
      </div>
    </div>
  );
}
