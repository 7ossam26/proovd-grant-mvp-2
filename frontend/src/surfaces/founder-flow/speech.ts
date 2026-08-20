/**
 * The live transcript — Founder Flow v2 deviation 2, Positioning, 2026-08-20.
 *
 * ── Why this exists beside the transcription port ───────────────────────────
 * The reference's recording state streams words INTO the field while somebody
 * is speaking — `runDict` appends one word every 120ms and scrolls the box to
 * follow. `backend/src/transcription` cannot do that: it takes a finished
 * recording and answers once, so with it alone the field stays empty for the
 * whole recording and every word lands in one lump at the end. That is a
 * different experience, and the screen was asked to match the reference's.
 *
 * So the browser's own `SpeechRecognition` is the engine when it is there, and
 * the port is the fallback when it is not. The port is NOT replaced: it is
 * still the only path on a browser without speech recognition, and it is still
 * the thing `frontend/src/surfaces/founder-flow/Dictation.tsx` uses for Story.
 *
 * ── It transcribes. That is the whole of it ─────────────────────────────────
 * The same four constraints the port records, held the same way — by absence:
 *
 *  1. **No generate, summarize, rewrite or suggest.** One function, and what it
 *     hands back is what was said. There is no second method to reach for.
 *  2. **The audio is not kept.** Nothing here holds a stream, a blob, or a
 *     buffer — `SpeechRecognition` owns its own capture and this module never
 *     sees the samples. There is nowhere to put audio even by mistake.
 *  3. **The transcript is the Founder's text.** It lands in the textarea as
 *     ordinary editable content and saves through the same autosave typing
 *     uses, with supplier `founder`. §9's "never represented as AI-generated"
 *     stays true: nothing generated it, a machine typed what was said.
 *  4. **It touches no Stripe gateway**, so it needs no §34 disposition.
 *
 * ── One fact worth stating plainly ──────────────────────────────────────────
 * Chrome's implementation of this API is cloud-backed: the audio leaves the
 * browser to Google's service, exactly as the port's audio would leave to
 * whichever vendor it is configured with. Proovd stores neither. Recorded
 * rather than glossed, because "it runs in the browser" reads as "it never
 * leaves the device" and that is not true of this API.
 *
 * **This was raised and accepted (2026-08-20, product direction): the browser
 * engine stays primary as it is.** It is written down so it is a settled
 * decision rather than something a later session re-opens as a finding — and
 * so that whoever changes it later changes it deliberately.
 *
 * ── Restarting is the whole implementation ──────────────────────────────────
 * `continuous` is a request, not a promise: every browser ends a run on its own
 * after a stretch of silence and fires `onend`. So a session that is not
 * finished and not paused starts again there. Without that, dictation stops
 * mid-sentence when somebody pauses to think, and nothing says why.
 */

/* ── The vendor surface, narrowed to what is used ──────────────────────────
   TypeScript's DOM lib does not carry these (the API is unprefixed only in
   recent Chromium and is not in the standard lib), so they are declared here
   rather than reached for through `any` — which would take the compiler off
   the one place a typo in an event field would otherwise be silent. */

interface RecognitionAlternative {
  readonly transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternative | undefined;
}
interface RecognitionResultList {
  readonly length: number;
  readonly [index: number]: RecognitionResult | undefined;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: RecognitionResultList;
}
interface RecognitionErrorEvent {
  readonly error: string;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function constructor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Whether this browser can produce a live transcript at all. */
export function speechSupported(): boolean {
  return constructor() !== null;
}

/**
 * Why a session ended without words, in the terms the screen has to explain.
 *
 * `denied` is a decision somebody made and is worth naming; the other two are
 * the same sentence to a Founder — nothing was recorded — and are kept apart
 * only so the screen can say the true one.
 */
export type SpeechRefusal = 'denied' | 'no_microphone' | 'unavailable';

export interface SpeechSession {
  /** Stop listening and keep every settled word. */
  pause(): void;
  resume(): void;
  /** Finish. `onEnded` follows. */
  stop(): void;
  /** Finish now and expect nothing more — the caller is discarding the words. */
  abandon(): void;
}

function join(left: string, right: string): string {
  if (!right) return left;
  if (!left) return right;
  return left + ' ' + right;
}

/**
 * Start listening.
 *
 * `onText` is called with everything heard SO FAR in this session — settled
 * words plus the interim tail — rather than with a delta. The caller holds the
 * text the Founder had typed before the recording began and writes
 * `base + heard`, so the two can never drift apart and `Retry` is the base
 * alone. A delta API would make dropping one callback silently lose a word.
 *
 * Returns `null` when the browser has no such API, which is the caller's cue to
 * use the transcription port instead.
 */
export function startSpeech(handlers: {
  /**
   * The microphone is open. Called when capture actually begins, which on a
   * first visit is AFTER somebody has answered the permission prompt — so the
   * screen can say `LISTENING` at the moment it is true rather than over a
   * dialogue box that has not been answered yet.
   */
  onListening: () => void;
  onText: (heard: string) => void;
  onRefused: (reason: SpeechRefusal) => void;
  onEnded: () => void;
}): SpeechSession | null {
  const Ctor = constructor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  /**
   * A FULL tag, and deliberately not `document.documentElement.lang`.
   *
   * The document says `lang="en"`, and a bare primary subtag is not a language
   * these engines resolve: handed `en` they fall back to the machine's own
   * locale, so a founder on an Arabic Windows dictating English got Arabic
   * script in the box. Observed, not theorised. The product's copy is English
   * throughout — the placeholder on this very field is English — so the tag is
   * stated rather than derived, and it is `en-US` because that is the region
   * every other US-facing rule in this product assumes.
   */
  recognition.lang = 'en-US';

  /** Words the engine has committed to. Interim text is never folded in here:
   *  it is still being revised, and a revision would otherwise append twice. */
  let settled = '';
  let finished = false;
  let paused = false;
  let refused = false;

  /**
   * `onEnded` fires exactly once, and the caller is told even if the engine
   * never says so.
   *
   * `stop()` on a recognition that has ALREADY ended emits no `onend` at all —
   * and it is constantly ending on its own, because `continuous` gives out
   * after a stretch of silence and the handler below restarts it. Press Done
   * inside that gap and the stop lands on a dead object: the recording state
   * stayed on screen for good, with no way back to the box. Reported from a
   * real browser; unreachable in a scripted one, whose stub always answers.
   */
  let ended = false;
  let guard = 0;
  const finish = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(guard);
    handlers.onEnded();
  };

  const begin = () => {
    try {
      recognition.start();
    } catch {
      // Already running. Calling `start` twice throws rather than no-opping,
      // and the browser's own run is the one that matters.
    }
  };

  recognition.onaudiostart = () => {
    if (!finished && !refused) handlers.onListening();
  };

  recognition.onresult = (event) => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result?.[0]?.transcript?.trim() ?? '';
      if (!text) continue;
      if (result?.isFinal) settled = join(settled, text);
      else interim = join(interim, text);
    }
    handlers.onText(join(settled, interim));
  };

  recognition.onerror = (event) => {
    // `no-speech` and `aborted` are ordinary: somebody paused to think, or this
    // module ended the run itself. Neither is a refusal and neither stops the
    // session — `onend` restarts it.
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    refused = true;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      handlers.onRefused('denied');
    } else if (event.error === 'audio-capture') {
      handlers.onRefused('no_microphone');
    } else {
      handlers.onRefused('unavailable');
    }
  };

  recognition.onend = () => {
    if (finished || refused) {
      finish();
      return;
    }
    if (paused) return;
    // `continuous` ends on its own after silence. Keep going.
    begin();
  };

  begin();

  return {
    pause() {
      if (finished) return;
      paused = true;
      recognition.stop();
    },
    resume() {
      if (finished) return;
      paused = false;
      begin();
    },
    stop() {
      finished = true;
      try {
        recognition.stop();
      } catch {
        // Already stopped. `finish` below is what closes the session either way.
      }
      // Long enough for a real `onend` to win the race, short enough that
      // nobody is left looking at controls that no longer do anything.
      guard = window.setTimeout(finish, 250);
    },
    abandon() {
      finished = true;
      try {
        // `abort` rather than `stop`: `stop` finalises the interim tail into
        // one last `onresult` first, and the caller has already thrown these
        // words away. It would arrive after they had.
        recognition.abort();
      } catch {
        // As above.
      }
      guard = window.setTimeout(finish, 250);
    },
  };
}
