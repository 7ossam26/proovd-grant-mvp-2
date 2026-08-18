/**
 * Screen 9 — Positioning, and the submission — Founder Flow v2, Session C.
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
 * ── Dictation transcribes, and does nothing else ────────────────────────────
 * Founder Flow v2 deviation 2. The recording goes up, the text comes back, and
 * the audio is never stored — there is no column for it, no bucket key, and no
 * job. The transcript lands in this textarea as ordinary editable text with
 * supplier `founder` and saves through the same autosave typing does, which is
 * exactly what keeps §9's "never represented as AI-generated" true: nothing
 * generated it, a machine typed what was said. While the port is unconfigured
 * (Track A) the read says so and the screen renders the reason rather than a
 * microphone that refuses.
 *
 * ── This screen submits, which is where the campaign type locks ─────────────
 * §9's lock is at submission and §10 puts the relevance signal "immediately
 * after valid vetting", so Continue submits and then goes to the match. The
 * permanence warning is on the screen for the second time — the first was the
 * campaign-path step, and this is the last moment it is still a draft answer.
 *
 * ── It does NOT re-ask Problem or Solution ──────────────────────────────────
 * The reference asks both twice: screens 2–3, then again at 7–8, whose own help
 * card calls it "last look at the problem and the solution". §9 has one
 * `problem_text` and one `solution_text`, and screens 2–3 are those two answers.
 * A record collected in two places is a record whose two copies eventually
 * disagree. What this screen does instead is name a missing earlier answer and
 * link back to the page that owns it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  CAMPAIGN_TYPE_LOCK_WARNING,
  VETTING_STEPS,
  founderFlowPage,
  founderFlowPath,
} from '@proovd/shared';
import { Button, Field, Tag, Textarea } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { describeSaveState } from '../../lib/autosave.js';
import { useAutosave } from '../../lib/useAutosave.js';
import { LinkUnavailable } from '../LinkUnavailable.js';
import {
  fetchVetting,
  saveVetting,
  submitVetting,
  transcribeAudio,
  type VettingPatch,
  type VettingState,
} from '../draft/api.js';
import { FlowPage, useFlowNav } from './FlowPage.js';

const STEP = VETTING_STEPS.find((step) => step.id === 'competition')!;

/** The two answers this screen depends on, and the page that owns each. */
const EARLIER = [
  { key: 'problem' as const, pageId: 'problem' },
  { key: 'solution' as const, pageId: 'solution' },
];

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
    <FlowPage pageId="positioning" token={token} badge>
      <Body token={token} loaded={loaded} />
    </FlowPage>
  );
}

function Body({ token, loaded }: { token: string; loaded: VettingState }) {
  const { leave } = useFlowNav();
  const [answer, setAnswer] = useState(loaded.competition ?? '');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const autosave = useAutosave<VettingPatch>(
    useCallback((patch: VettingPatch) => saveVetting(token, patch), [token]),
  );

  const status = describeSaveState(autosave.state);
  const missing = EARLIER.filter((entry) => !loaded.completeness[entry.key]);
  const hint = loaded.selectedType ? STEP.hint[loaded.selectedType] : null;

  function change(next: string) {
    setAnswer(next);
    autosave.queue({ competition: next });
  }

  async function submit() {
    if (busy || !answer.trim() || missing.length > 0) return;
    setBusy(true);
    setRefusal(null);
    try {
      await autosave.flush();
      const result = await submitVetting(token);
      if (result.submittedAt) {
        leave(founderFlowPath('match', token), 1);
        return;
      }
      setRefusal('That did not go through. Everything you have written is saved.');
    } catch (error) {
      // The server re-decides what the screen decided, and its refusal is what
      // a Founder reads (§1.1). It names the answer or the path that is
      // missing; nothing here paraphrases it.
      setRefusal(
        error instanceof Error && error.message
          ? error.message
          : 'That did not go through. Everything you have written is saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ff-answer">
      <h1 className="ff-answer__head" data-anim="head">
        {STEP.title}
      </h1>
      <p className="ff-answer__lede" data-anim="sub">
        {STEP.why}
      </p>

      {missing.length > 0 ? (
        <p className="ff-answer__missing" role="alert" data-anim="note">
          One earlier answer is still empty:{' '}
          {missing.map((entry, index) => {
            const page = founderFlowPage(entry.pageId);
            return (
              <span key={entry.key}>
                {index > 0 ? ', ' : null}
                <a href={founderFlowPath(entry.pageId, token)}>{page?.title ?? entry.pageId}</a>
              </span>
            );
          })}
          . Everything you have written here is saved.
        </p>
      ) : null}

      <div className="ff-answer__field" data-anim="field">
        <Field label={STEP.label} hint={hint ?? STEP.expected}>
          <Textarea
            rows={10}
            value={answer}
            placeholder={STEP.placeholder}
            onChange={(event) => change(event.target.value)}
          />
        </Field>
        <p className="ff-answer__note">
          <Tag>Your words</Tag> {STEP.next}
        </p>
      </div>

      <Dictation
        token={token}
        availability={loaded.transcription}
        onText={(text) => change(answer ? `${answer.trimEnd()} ${text}` : text)}
      />

      <p className="ff-answer__warning" data-anim="note">
        {CAMPAIGN_TYPE_LOCK_WARNING}
      </p>

      {refusal ? (
        <p className="ff-answer__refusal" role="alert">
          {refusal}
        </p>
      ) : null}

      <div className="ff-nav" data-anim="cta">
        <Button tier="tertiary" onClick={() => leave(founderFlowPath('code', token), -1)}>
          Back to Confirm your email
        </Button>
        <span
          className="ff-confirm__status"
          role="status"
          aria-live="polite"
          data-state={autosave.state.status}
        >
          {status}
        </span>
        <Button
          tier="primary"
          disabled={busy || !answer.trim() || missing.length > 0}
          onClick={() => void submit()}
        >
          Submit and see your Creator match
        </Button>
      </div>
    </div>
  );
}

/**
 * "Say it instead" — deviation 2's one control.
 *
 * There is exactly one thing it does. No suggest, no rewrite, no summarise, and
 * no second button that offers any of those: §12 forbids an embedded AI product
 * and §30 defers AI rewriting by name, and the absence is what enforces it.
 *
 * While the port is unconfigured the reason renders where the control would be
 * — the Affiliate evidence uploader's arrangement, for its reason. A microphone
 * that refuses when pressed is worse than no microphone, because somebody has
 * already spoken into it.
 */
function Dictation({
  token,
  availability,
  onText,
}: {
  token: string;
  availability: VettingState['transcription'];
  onText: (text: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  const [failed, setFailed] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (availability && !availability.available) {
    return (
      <p className="ff-answer__dictation-absent" data-anim="note">
        {availability.absentBecause}
      </p>
    );
  }

  async function start() {
    setFailed(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      chunks.current = [];
      media.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      media.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: media.mimeType || 'audio/webm' });
        chunks.current = [];
        setState('working');
        try {
          const { text } = await transcribeAudio(token, blob);
          if (text.trim()) onText(text.trim());
        } catch {
          setFailed(true);
        } finally {
          setState('idle');
        }
        // The recording is not kept here either. `blob` goes out of scope with
        // this callback and nothing holds a reference to it.
      };
      recorder.current = media;
      media.start();
      setState('recording');
    } catch {
      setFailed(true);
      setState('idle');
    }
  }

  function stop() {
    recorder.current?.stop();
    recorder.current = null;
  }

  return (
    <div className="ff-answer__dictation" data-anim="note">
      {state === 'recording' ? (
        <Button tier="secondary" onClick={stop}>
          Stop recording and add the words
        </Button>
      ) : (
        <Button tier="secondary" disabled={state === 'working'} onClick={() => void start()}>
          {state === 'working' ? 'Turning your recording into words…' : 'Say it instead'}
        </Button>
      )}
      <span className="ff-answer__dictation-note">
        We turn what you say into text in this box. Nothing is written for you, and the recording
        is not kept.
      </span>
      {failed ? (
        <p role="alert" className="ff-answer__refusal">
          We could not turn that recording into text, so nothing was added. Type your answer
          instead — it is the same box either way.
        </p>
      ) : null}
    </div>
  );
}
