/**
 * Your story — Founder Flow v2, the reference's `[data-story]`.
 *
 * REBUILT FROM SCRATCH 2026-08-20 against the supplied reference
 * (`Proovd Founder Flow v2.dc.html`, `[data-story]` / `kindWide`) and its
 * screenshot, on the same instruction and the same terms as the Positioning
 * and Socials screens. The surface that stood here was Session D's `AnswerPage`
 * layout — a trail line, the Optional tag and its discount, the question as the
 * heading, a labelled `Field`/`Textarea`, the `Dictation` component, an
 * `Option` checkbox and the §12 helper accordion. None of that composition is
 * left. What replaced it is the reference's own: one headline, one field on a
 * fixed stage, and a two-control row.
 *
 * ── The layout model is the reference's, not an approximation of it ────────
 * This page is not laid out responsively there. It is authored once, on a fixed
 * 2496x1542 stage, and that stage is scaled to the viewport:
 *
 *     fitStages(){ let s = Math.min(innerWidth/2496, innerHeight/1542)
 *                          * (Number(this.props.pageScale) || .78); … }
 *
 * No branch of that function names this screen — `c` is `vetting`, `vReviewing`
 * is false, and the per-page multipliers are for `claim`/`reach`/`kind`,
 * `intake`, `approval` and the two paper screens — so it takes `pageScale`
 * alone. Inside that stage sits an 1800px column, centred, and every child
 * below carries the reference's own pixel value on it.
 *
 * Measured against the running prototype at 1280x800: scale 0.4, column
 * 720x477.5 at (272.5, 161.25), headline 47.1 tall on an 1800x118 box, field
 * 720x316 (1800x790), the row 60 tall (150) with `Say it instead` 264 wide
 * (660) and `Next` 441.6 (1104), Back at (38.39, 731.61), the badge 66.55
 * square at (1160.06, 695.06). Recording: the column rises to y 126.65, the
 * control row is 254.4x105.2 at (505.3, 568.15), and the field's ink and ground
 * both turn brand.
 *
 * `isClaimPhone()` returns `false` in the reference — "one composition
 * everywhere: the phone posture stays off" — so its `kindPhone` branch is dead
 * code and this composition is what every viewport gets, exactly as there.
 *
 * ── This screen HAS the reference's chrome ────────────────────────────────
 * `[data-story]` draws the wordmark, HELP, the message badge and Back inside a
 * `z-index: 25` fixed sheet. So `FlowPage`'s own `.ff__top` and `.ff__badge`
 * are hidden here and the four controls are drawn inside that sheet, where the
 * reference puts them — otherwise they would sit underneath it and be
 * unreachable. HELP and the badge open the SAME drawer, which is what the
 * reference does (`onClick="{{ openHelp }}"` on both).
 *
 * The badge's `{{ mailCount }}` is `2 + max(0, vStep - 3)` there — five on this
 * screen, which is what the screenshot shows. There is no inbox in this product
 * and an unread count over a message system that does not exist is §1.4's
 * failure with a number on it. It carries the number of reading cards the
 * drawer actually holds, and the control's accessible name says so.
 *
 * It does not shake. The reference loops it every six seconds for as long as
 * the page is open; `FlowPage` has recorded since Session B that an element
 * moving indefinitely to draw attention is the pattern DNA §5.10 and §30 name,
 * whatever it opens. That decision is unchanged here.
 *
 * ── Dictation: the reference's picture, this product's recorder ───────────
 * Founder Flow v2 deviation 2, and this is the screen it was written for.
 * Every part of the reference's recording state is reproduced — the handoff
 * where `Next` collapses as the microphone takes the row, the tinted field,
 * `LISTENING — 0:07` at the field's bottom-right, the 72-bar waveform drawing
 * itself up from the centre, and Pause / Done / Retry at 176, 196 and 176
 * square.
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
 * The port is not replaced: it is `POST /api/founder/campaigns/:id/transcribe`,
 * which is what a browser with no speech recognition uses. Which engine ran is
 * invisible to the record — both write ordinary editable Founder text into the
 * same box through the same autosave.
 *
 * The microphone is offered whenever EITHER engine can run. Gating it on the
 * port alone would hide the whole recording state on every deployment where
 * transcription is unconfigured, which is this one (Track A4).
 *
 * `Retry` matches the reference, correctly scoped. There it clears the answer
 * (`ans[id]={...,text:''}`) because there the whole answer came from dictation.
 * Here it restores what the box held when the recording STARTED, so it throws
 * away exactly the words this recording added and never a word the Founder
 * typed. A control that silently deleted a typed answer would be the worst
 * thing on this screen.
 *
 * The recording is never kept — no column, no bucket key, no job — and the
 * transcript lands in the textarea as ordinary Founder text saved through the
 * same autosave typing uses. §12 refusing a bare transcript is not a reason to
 * withhold the microphone; it is the reason the microphone is harmless, because
 * the approval below still has to happen afterwards, by a person, on the words
 * as they stand.
 *
 * ── Approval is the completing act ─────────────────────────────────────────
 * A saved story only earns its optional-item discount after the Founder has
 * approved the words as they stand. The control lives in the stage-scaled
 * block below the reference composition, so it does not move that composition.
 *
 * ── §12's helper resources moved into the drawer, not out of the product ──
 * The reference's composition has nowhere to put a four-section accordion, and
 * `HELP` is where it puts help. So `HELPER_RESOURCES`' story guidance — the
 * points, the copy-ready prompts, and its own "a transcript is not a story"
 * limits — rides the same drawer HELP and the badge open, above the reading
 * cards. There is still no generate control anywhere in it and no route it
 * could call (§12, §30).
 *
 * ── §12's lock ───────────────────────────────────────────────────────────
 * After the listing fee is paid the calculation and its evidence lock and the
 * server refuses a write. The reference has no such state; the field goes
 * read-only, the microphone and the approval are absent rather than offered,
 * and the block below says so — a control the server will refuse is §1.4's
 * failure with a cursor on it.
 *
 * ── No global Enter handler ──────────────────────────────────────────────
 * The reference binds one (`enterAdvance`), and it is already inert whenever
 * focus is in the textarea — which is where focus is on this screen. What it
 * would add is a keystroke that leaves the page from anywhere on it.
 *
 * ── The typed value never comes back from the server ─────────────────────
 * `useAutosave` reports an outcome and returns nothing, deliberately: the
 * caller's state is the only copy of what was typed, and that one decision is
 * the whole autosave bug class (§9: "a failed save never clears valid fields").
 * `useSetupWorkspace` applies everything the server DERIVED and never a text
 * field, which is why the box below is seeded exactly once.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { founderAnswerNext, founderAnswerPrevious, founderFlowIndex } from '@proovd/shared';
import { SurfaceLoading } from '../../features/public/states.js';
import { StatePanel, NO_ACTION } from '../../components/index.js';
import { recIntro, sayHandoff, stageRelayIn } from '../../components/anim.js';
import { describeSaveState } from '../../lib/autosave.js';
import { transcribeStory, type WorkspaceState } from '../founder/api.js';
import { FlowPage, HelpDrawer, flowDirection, useFlowNav } from './FlowPage.js';
import { speechSupported, startSpeech, type SpeechSession } from './speech.js';
import { useSetupWorkspace, type SetupWorkspace } from './useSetup.js';

/* ── The stage ─────────────────────────────────────────────────────────────
   `fitStages()` for a page it treats as ordinary: the stage's own size as the
   divisors and `pageScale` alone. At 1280x800 that is exactly 0.4, which is
   what the reference measures at. */

const FIT_W = 2496;
const FIT_H = 1542;
/** The prototype's `pageScale` prop default. */
const PAGE_SCALE = 0.78;

function stageScale(): number {
  return Math.min(window.innerWidth / FIT_W, window.innerHeight / FIT_H) * PAGE_SCALE;
}

/**
 * The reference's own relay order for this screen, out of `verifyIntro`'s fixed
 * list `pill, head, field, boxes, note, fee, sub, hint, panel, art, art2, cta,
 * edit`. Passed to `stageRelayIn` rather than read from the DOM, because the
 * 0.085s stagger follows THAT order and not document order.
 *
 * `[data-story]` matches none of `verifyIntro`'s earlier branches — no
 * `[data-anim="grow"]`, no cupids, no `[data-flourish]`, and it is neither
 * `[data-lastlook]` nor `[data-paynow]` — so `runRelay()` is all it gets.
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
  (_, i) => 18 + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)) * 78) + '%',
);

/** `cTime`, verbatim: `Math.floor(s/60)+':'+String(s%60).padStart(2,'0')`. */
function clock(seconds: number): string {
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

export function StoryStep() {
  const { campaignId = '' } = useParams();
  const setup = useSetupWorkspace(campaignId);

  if (setup.failure) {
    return (
      <FlowPage pageId="story" param={campaignId}>
        <div className="ff-story__failure">
          <StatePanel
            state="We could not open your campaign"
            whatHappened={setup.failure}
            next="Reload the page. Nothing you have saved is affected — this is only about reading it back."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: '/support' }}
            ring
          />
        </div>
      </FlowPage>
    );
  }

  if (!setup.state) {
    return <SurfaceLoading subject="your story" reference="Your campaign" />;
  }

  return (
    <FlowPage pageId="story" param={campaignId}>
      <StoryScreen campaignId={campaignId} setup={{ ...setup, state: setup.state }} />
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
    'Your browser blocked the microphone, so nothing was recorded. Allow it in the address bar to try again — or type your story instead, it is the same box either way.',
  no_microphone:
    'We could not reach a microphone, so nothing was recorded. Type your story instead — it is the same box either way.',
  unavailable:
    'Dictation stopped and nothing more was recorded. Anything already written down is still there — carry on typing, it is the same box either way.',
};

/** Split from the loader so `useFlowNav` — which only exists under `FlowPage` — is available. */
function StoryScreen({
  campaignId,
  setup,
}: {
  campaignId: string;
  setup: SetupWorkspace & { state: WorkspaceState };
}) {
  const { leaveToPage } = useFlowNav();
  const [params] = useSearchParams();
  const fromReview = params.get('from') === 'review';

  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // Read once, during the first render: `FlowPage` resets the module value in
  // its own layout effect, and a later re-render would read the reset.
  const direction = useRef<1 | -1 | null>(null);
  if (direction.current === null) direction.current = flowDirection();

  const { state, autosave } = setup;

  // The local copy is the only copy of what was typed (§9). A save response
  // never writes back into it, which is why it is seeded exactly once.
  const [answer, setAnswer] = useState(state.story.text ?? '');
  const [approved, setApproved] = useState(state.story.approved);
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  /** Bumped whenever the say-row must come back with no GSAP left on it. */
  const [attempt, setAttempt] = useState(0);
  /** Bumped for each recording, so `recIntro` runs once per session and not on
   *  every pause. */
  const [session, setSession] = useState(0);
  const [alert, setAlert] = useState<string | null>(null);

  /**
   * The live recorder, and whether the audio it is holding is wanted.
   *
   * `drop` lives on the SESSION rather than in a ref of its own: `stop()` fires
   * `onstop` as a task and `retry` schedules the next recording on the very
   * next frame, so with one shared flag the new session could clear it before
   * the old session's `onstop` had read it — and the recording somebody had
   * just discarded would be transcribed and appended anyway. Each `onstop`
   * closes over its own object.
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

  // The entrance — `verifyIntro`'s `runRelay`, which is all this screen gets.
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
  const locked = state.listingPaid;
  const dictation = state.transcription;
  /** The port, as the workspace read reports it. Absent means an older payload,
   *  which is treated as configured — the request is the thing that decides. */
  const portReady = !dictation || dictation.available;
  /** The microphone is offered when EITHER engine can run. */
  const canDictate = !locked && (speechReady || portReady);
  const recording = phase === 'live' || phase === 'paused';

  const previous = founderAnswerPrevious('story');
  const next = founderAnswerNext('story');
  const backId = fromReview ? 'last-look' : (previous?.pageId ?? 'last-look');
  const forwardId = fromReview ? 'last-look' : (next?.pageId ?? 'last-look');

  function change(nextText: string) {
    setAnswer(nextText);
    if (approved) setApproved(false);
    autosave.queue({
      storyText: nextText,
      ...(approved ? { storyApproved: false } : {}),
    });
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
   * Every keystroke of it goes through the same autosave typing uses, so a fast
   * talker produces one save rather than one per word.
   */
  function write(nextText: string) {
    latest.current = nextText;
    change(nextText);
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

  /** The click. Guards on the phase, then hands off to `beginHandoff`. */
  function say() {
    if (phase !== 'idle' || !canDictate) return;
    beginHandoff();
  }

  /**
   * The handoff and the recording, with NO phase guard.
   *
   * `retry` restarts from inside a render whose `phase` is still `live`, so a
   * guard here would read that stale value and silently do nothing. The guard
   * belongs to the click, which is the only place a person can start a second
   * recorder by accident.
   */
  function beginHandoff() {
    setAlert(null);
    setPhase('arming');
    base.current = latest.current;
    engine.current = speechReady ? 'speech' : 'port';
    if (engine.current === 'speech') {
      // The engine starts NOW, not at the end of the handoff. Opening a
      // microphone takes real time — permission, device init, the service
      // handshake — and starting it in the animation's completion callback puts
      // all of that AFTER the 0.38s handoff, which leaves a blank beat with the
      // say-row already faded and the controls not yet arrived. The controls
      // then appear when BOTH have landed, which on any use after the first is
      // the instant the animation ends.
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
  function startLiveRun(): (() => void) | null {
    /**
     * Two signals have to land before the recording state appears, and neither
     * one alone is right. On the animation alone, the controls arrive over a
     * microphone that may still be opening and the clock counts seconds nobody
     * recorded. On the microphone alone they can arrive mid-handoff, while the
     * say-row is still collapsing. So: whichever is second.
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
     * `Retry` abandons this one and starts the next on the very next frame, and
     * `abort` fires `onend` as a task — so without this the ending of the
     * recording somebody just discarded would arrive after its replacement had
     * begun and send the screen back to idle.
     */
    let self: SpeechSession | null = null;
    const mine = () => self !== null && speech.current === self;

    const live = startSpeech({
      onListening: () => {
        open = true;
        enter();
      },
      onText: (heard) => {
        if (!mine()) return;
        const nextText = heard
          ? base.current
            ? base.current + ' ' + heard
            : heard
          : base.current;
        write(nextText);
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

    if (!live) {
      // The API vanished between the check and the click. The port is the only
      // thing left, and if it is not configured either there is nothing to run.
      if (portReady) {
        engine.current = 'port';
        startPortRun();
        return null;
      }
      toIdle();
      setAlert(REFUSAL.unavailable!);
      return null;
    }
    self = live;
    speech.current = live;

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
   * between. It is the fallback rather than the only path.
   */
  function startPortRun() {
    // The tween is created BEFORE the microphone is asked for, and the order is
    // load-bearing rather than tidy: `getUserMedia` can hold the main thread for
    // tens of milliseconds, which puts the whole handoff late. A time-based
    // tween created first absorbs the same block by arriving at the right
    // progress on its first painted frame instead.
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

    sayHandoff(root.current, () => {
      void acquire().then((stream) => {
        if (!stream) {
          toIdle();
          setAlert(REFUSAL.denied!);
          return;
        }
        const media = new MediaRecorder(stream);
        const own = { media, drop: false };
        chunks.current = [];
        media.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.current.push(event.data);
        };
        media.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          const parts = chunks.current;
          chunks.current = [];
          if (recorder.current === own) recorder.current = null;
          if (own.drop) return;
          const blob = new Blob(parts, { type: media.mimeType || 'audio/webm' });
          setPhase('working');
          void transcribeStory(campaignId, blob)
            .then(({ text }) => append(text))
            .catch(() =>
              setAlert(
                'We could not turn that recording into words, so nothing was added. Type your story instead — it is the same box either way.',
              ),
            )
            .finally(toIdle);
        };
        recorder.current = own;
        media.start();
        enterRecording();
      });
    });

    // …and asked for immediately after, so the prompt and the handoff run at
    // the same time rather than one after the other.
    void acquire();
  }

  /**
   * `cPauseToggle`. The engine itself pauses, so what the screen says and what
   * the microphone is doing cannot come apart — the reference's `pauseDict`
   * clears the word timer rather than only relabelling the button.
   *
   * The seconds follow `phase` (`tickSecs` ignores anything but `live`), and
   * the waveform deliberately does NOT stop: `pauseDict` sets the flag and
   * re-binds, and `loops()`' own guard leaves the running tweens alone. A still
   * waveform over a paused recording would be a second way of saying the same
   * thing, and the reference says it once, in the label.
   */
  function pauseToggle() {
    if (engine.current === 'speech') {
      const live = speech.current;
      if (!live) return;
      if (phase === 'live') {
        live.pause();
        setPhase('paused');
      } else if (phase === 'paused') {
        live.resume();
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
    const own = recorder.current;
    if (!own) return;
    own.drop = false;
    own.media.stop();
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
    if (engine.current === 'speech') {
      speech.current?.abandon();
      speech.current = null;
      write(base.current);
    } else {
      const own = recorder.current;
      if (own) {
        own.drop = true;
        own.media.stop();
      }
      recorder.current = null;
    }
    setPhase('idle');
    setAttempt((n) => n + 1);
    setSeconds(0);
    // A frame for the say-row to mount before the handoff measures it.
    window.requestAnimationFrame(() => beginHandoff());
  }

  /** `storyNext:()=>{ this.endDict(); this.afterSection({vStep:7}); }` — the
   *  recording ends and the flow moves on. Story is optional (§12), so this is
   *  never blocked: the reference's `Next` always advances and so does ours. */
  function forward() {
    if (engine.current === 'speech') speech.current?.abandon();
    else if (recorder.current) {
      recorder.current.drop = true;
      recorder.current.media.stop();
    }
    void autosave.flush().finally(() => leaveToPage(forwardId, 1));
  }

  // The drawer's own card count — the number the badge shows, and the only
  // number on this page that is a count of something real.
  const cards = Math.max(0, founderFlowIndex('story') + 1);
  const backTitle = fromReview ? 'Last look' : (previous ? 'Your interview' : 'Last look');

  return (
    <div className="ff-story" ref={root}>
      {/* The reference's own control, bottom-left. Its label names where it
          goes only to a screen reader: the visible word is its own `Back`, and
          §33.11.4's objectless-CTA rule is answered by the accessible name
          rather than by overriding the reference's copy. */}
      <button
        type="button"
        className="ff-story__back"
        aria-label={`Back to ${backTitle}`}
        onClick={() => leaveToPage(backId, -1)}
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

      <div className="ff-story__top">
        {/* Not a link. A campaign's own half-finished form is not a site, and
            the way out of one should not be the brand. */}
        <img className="ff-story__logo" src="/assets/proovd-logo.svg" alt="Proovd" />
        <HelpDrawer
          pageId="story"
          param={campaignId}
          trigger={
            <button type="button" className="ff-story__help">
              Help
            </button>
          }
        />
      </div>

      {/* The reference's mail bell, bottom-right, opening the same drawer HELP
          does. See the header for what its number is and is not. */}
      <HelpDrawer
        pageId="story"
        param={campaignId}
        trigger={
          <button
            type="button"
            className="ff-story__mailbtn"
            aria-label={`Help and reading — ${cards} pages`}
          >
            <span className="ff-story__mail" aria-hidden="true">
              <img src="/assets/mail.webp" alt="" />
              <span className="ff-story__mailcount">{cards}</span>
            </span>
          </button>
        }
      />

      <div className="ff-story__stage" data-page-stage="1" ref={stage}>
        <div className="ff-story__col">
          <h1 className="ff-story__head" data-stage-anim="head">
            We want to know your Story
          </h1>

          <div
            className="ff-story__panel"
            data-stage-anim="panel"
            data-rec={recording ? 'on' : undefined}
          >
            <textarea
              className="ff-story__field"
              data-slim-scroll="1"
              ref={field}
              // A 316px box with no label is unusable with a screen reader, and
              // an `aria-label` renders nothing. The reference gives it none.
              aria-label="Your story"
              placeholder="It all started in uni when we had a project..."
              value={answer}
              readOnly={locked}
              onChange={(event) => change(event.target.value)}
            />

            {recording ? (
              <div className="ff-story__overlay" aria-hidden="true">
                <span className="ff-story__fade" />
                <span className="ff-story__meter">
                  <span className="ff-story__level">
                    {phase === 'paused' ? 'PAUSED' : 'LISTENING'} — {clock(seconds)}
                  </span>
                </span>
                <span className="ff-story__wave">
                  {WAVE.map((height, index) => (
                    <span key={index} data-wave="1" className="ff-story__bar" style={{ height }} />
                  ))}
                </span>
              </div>
            ) : null}
          </div>

          {recording ? (
            <div className="ff-story__rec" data-stage-anim="cta" data-rec-row="1">
              <span className="ff-story__ctl">
                <button type="button" className="ff-story__ghost" onClick={pauseToggle}>
                  {phase === 'paused' ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="82"
                      height="82"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M8 5l11 7-11 7z" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      width="82"
                      height="82"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <rect x="6" y="5" width="4" height="14" />
                      <rect x="14" y="5" width="4" height="14" />
                    </svg>
                  )}
                </button>
                <span className="ff-story__ctl-label">
                  {phase === 'paused' ? 'Resume' : 'Pause'}
                </span>
              </span>

              <span className="ff-story__ctl">
                <button type="button" className="ff-story__done" onClick={done}>
                  <svg viewBox="0 0 64 54" width="96" height="81" fill="currentColor" aria-hidden="true">
                    <path d="M51.831 0L63.176 11.345L21.3447 53.2301L0 31.2893L9.19771 22.8065L21.3447 34.053L51.831 0Z" />
                  </svg>
                </button>
                <span className="ff-story__ctl-label">Done</span>
              </span>

              <span className="ff-story__ctl">
                <button type="button" className="ff-story__ghost is-retry" onClick={retry}>
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
                <span className="ff-story__ctl-label">Retry</span>
              </span>
            </div>
          ) : (
            <div className="ff-story__row" data-stage-anim="cta" data-say-row="1" key={attempt}>
              {canDictate ? (
                <button
                  type="button"
                  className="ff-story__say"
                  data-say-btn="1"
                  disabled={phase !== 'idle'}
                  onClick={say}
                >
                  <svg
                    viewBox="0 0 30 45"
                    width="42.667"
                    height="64"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M6.79727 27.9484C7.04159 29.9814 8.96996 31.6481 11.0729 31.6481H18.734C20.8369 31.6481 22.7653 29.9814 23.0096 27.9484L24.0305 19.5194C24.2748 17.4863 24.2748 14.1618 24.0305 12.12L23.0096 3.69096C22.7565 1.65788 20.8282 0 18.7253 0H11.0641C8.96124 0 7.03286 1.66661 6.78854 3.69969L5.77636 12.12C5.53204 14.1531 5.53204 17.4863 5.77636 19.5194L6.79727 27.9484ZM29.7807 14.8947H26.0636C26.0985 16.5963 26.0374 18.4025 25.8716 19.7462L24.8507 28.1752C24.493 31.1681 21.8054 33.5066 18.7253 33.5066H11.0641C7.99269 33.5066 5.30517 31.1594 4.9387 28.1752L3.91779 19.7462C3.752 18.4025 3.69092 16.5963 3.72583 14.8947H0.0086857C-0.026217 16.7533 0.0435885 18.6991 0.226828 20.1912L1.24773 28.6202C1.83235 33.4455 6.14284 37.2238 11.0641 37.2238H13.0361V40.9496H7.45169V44.6755H22.3464V40.9496H16.762V37.2238H18.734C23.664 37.2238 27.9745 33.4368 28.5504 28.6115L29.5713 20.1738C29.7458 18.6904 29.8156 16.7446 29.7807 14.8947Z" />
                  </svg>
                  {phase === 'working' ? 'Working…' : 'Say it instead'}
                </button>
              ) : null}

              <button
                type="button"
                className="ff-story__next"
                data-say-next="1"
                aria-label={fromReview ? 'Next — back to Last look' : 'Next — your socials'}
                onClick={forward}
              >
                Next
              </button>
            </div>
          )}

          {/* Absolutely positioned below the column, so nothing here can move
              the composition by a pixel. The reference has none of it, and each
              line is behaviour rather than decoration: the lock notice and the
              failure state §1.1 requires. It scales with the stage like
              everything else on the page — the reference's own model. */}
          <div className="ff-story__sub">
            {locked ? (
              <p className="ff-story__note">
                Your listing fee is paid, so this answer and the fee it earned are locked. You can
                read your story here; changing it is a support request.
              </p>
            ) : null}

            {!locked ? (
              <label className="ff-story__approve">
                <input
                  className="ff-story__check"
                  type="checkbox"
                  checked={approved}
                  disabled={!answer.trim()}
                  onChange={(event) => {
                    setApproved(event.target.checked);
                    autosave.queue({ storyApproved: event.target.checked });
                  }}
                />
                <span>I approve this story for my public campaign page</span>
              </label>
            ) : null}

            <p
              className="ff-story__status"
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
              {phase === 'working'
                ? 'Turning your recording into words. Nothing is written for you, and the recording is not kept.'
                : status}
            </p>

            {alert ? (
              <p className="ff-story__alert" role="alert">
                {alert}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
