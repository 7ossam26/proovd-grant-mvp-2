/**
 * The dictation port — Founder Flow v2 deviation 2, Session C, 2026-08-18.
 *
 * ── A RECORDED §1 rule 6 DEVIATION, built by product direction ──────────────
 * §12 requires the helper surfaces to be "static, copy-ready guidance — not an
 * embedded AI product", §30 defers AI rewriting by name, and there is no model
 * client anywhere in this tree. This adds one. It is recorded here the way the
 * 2026-08-10 Admin-MFA removal is — so a later session does not delete it, and
 * does not read it as licence for its neighbours.
 *
 * ── It transcribes. That is the whole of the deviation ──────────────────────
 * Dictation is transcription rather than generation, which is the narrower half
 * of what §30 defers — the Founder's own words, typed by a machine instead of
 * by them. Four constraints keep it there, and each is an absence rather than a
 * rule somebody has to remember:
 *
 *  1. **No generate, summarize, rewrite or suggest.** There is one method on
 *     this interface and it takes audio and returns text. No column holds a
 *     generated variant, no route offers one, and a test scans the flow's
 *     source for a generate path. The absence is the enforcement — and the
 *     temptation takes the form of a "suggest" affordance beside the mic, which
 *     is why §9's Positioning step is the first screen that offers dictation at
 *     all.
 *  2. **The audio is not kept.** §25.8 defines seven retention windows and none
 *     covers a dictation recording; inventing one would be §1 rule 6 in the
 *     other direction. So there is nowhere to put it: no column, no bucket key,
 *     no job. It is transcribed in the request that carried it and discarded
 *     when that request ends.
 *  3. **The transcript is the Founder's text.** It lands in the textarea as
 *     ordinary editable content with supplier `founder`, and the provenance
 *     trigger records it exactly as typing would. That is what keeps §9's
 *     "never represented as AI-generated" true on the one step where §9 says it
 *     twice — nothing generated it; a machine typed what was said.
 *  4. **It touches no Stripe gateway**, so it needs no §34 disposition.
 *
 * ── Unconfigured means it throws ────────────────────────────────────────────
 * `unconfiguredTranscription` refuses loudly, exactly as `unconfiguredStorage`,
 * `unconfiguredScheduler` and `unconfiguredTransport` do. Do not stub it, do
 * not no-op it, and do not return an empty transcript: a surface that reported
 * a recording as transcribed while nothing left the browser is the §1.4 failure
 * those three exist to prevent. The Founder-facing screen renders the absence
 * with the reason instead of a dead microphone.
 *
 * The §6 prerequisites PANEL that would block on this went with the old Admin
 * dashboard on 2026-08-10, and R2, Cal.com and the email transport are all in
 * the same position today. The refusal is the control that is actually running.
 */

export interface TranscriptionInput {
  /** The recorded audio, as delivered. Never written anywhere. */
  audio: Uint8Array;
  /** The browser's own `MediaRecorder` mime type, e.g. `audio/webm`. */
  contentType: string;
}

export interface TranscriptionResult {
  /** What was said. Nothing added, nothing removed, nothing rephrased. */
  text: string;
}

export interface Transcription {
  configured: boolean;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

/**
 * The sentence the refusal carries, and the one the surface renders.
 *
 * One constant so the two cannot disagree — the Founder reading "dictation is
 * not available" on the screen and an operator reading a different reason in
 * the log is how a Track A gap turns into a support case.
 */
export const TRANSCRIPTION_UNAVAILABLE =
  'Dictation is not set up on this deployment, so we cannot turn a recording into text. Nothing was recorded and nothing was sent. Type your answer instead — it is the same box either way.';

export const unconfiguredTranscription: Transcription = {
  configured: false,
  async transcribe() {
    throw new Error(
      `${TRANSCRIPTION_UNAVAILABLE} Set TRANSCRIPTION_API_URL and TRANSCRIPTION_API_KEY. ` +
        'This refusal is deliberate: reporting speech as transcribed when no provider exists ' +
        'would be the automation-that-does-not-exist failure (§1.4).',
    );
  },
};
