/**
 * "Say it instead" — deviation 2's one control — Founder Flow v2.
 *
 * Written for Positioning in Session C and lifted here in Session D, when Story
 * needed the same thing through a different route. The two differ in exactly
 * one way — which address the audio goes to, because §10's claim invalidated
 * the draft token between them — so the caller passes the call and everything
 * that keeps this narrow stays in one place.
 *
 * ── There is exactly one thing it does ──────────────────────────────────────
 * No suggest, no rewrite, no summarise, and no second button that offers any of
 * those: §12 forbids an embedded AI product and §30 defers AI rewriting by
 * name, and the absence is what enforces it. The text lands in the caller's own
 * box as ordinary editable Founder text and saves through the same autosave
 * typing does — which is what keeps §9's "never represented as AI-generated"
 * true, and what keeps §12's "a transcript does not count" true for Story,
 * because the Founder's approval is still the completing act afterwards.
 *
 * ── The recording is not kept, here or anywhere ─────────────────────────────
 * The blob goes out of scope with the callback below and nothing holds a
 * reference. There is no column for it, no bucket key and no job — §25.8
 * defines seven retention windows and none covers a dictation recording, so
 * inventing one would be §1 rule 6 in the other direction.
 *
 * ── While the port is unconfigured the reason renders where the control is ──
 * The Affiliate evidence uploader's arrangement. A microphone that refuses when
 * pressed is worse than no microphone, because somebody has already spoken
 * into it.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/index.js';

export type DictationAvailability =
  | { available: true }
  | { available: false; absentBecause: string };

export function Dictation({
  availability,
  transcribe,
  onText,
}: {
  availability: DictationAvailability | undefined;
  transcribe: (audio: Blob) => Promise<{ text: string }>;
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
    // The reference has no unavailable-service explanation on the answer
    // screen. Keep the server state for behavior, but do not invent a visible
    // deployment message that is absent from the composition.
    return null;
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
          const { text } = await transcribe(blob);
          if (text.trim()) onText(text.trim());
        } catch {
          setFailed(true);
        } finally {
          setState('idle');
        }
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
