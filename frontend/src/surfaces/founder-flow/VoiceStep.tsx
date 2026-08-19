/**
 * Screen 21 — your brand voice — Founder Flow v2, Session F.
 *
 * `campaign_build.brand_voice`, a §14.4-**required** text column that already
 * means exactly this. The reference draws adjective chips with a replacement
 * sheet and an "add more" sheet; what it is collecting is a description of how
 * the campaign should sound, and §14.4 has one field for that.
 *
 * ── The chips are a way into one field, not a second record ─────────────────
 * A repeater beside `brand_voice` would make §14.4's field and the Founder's
 * chips two answers to one question, and the one nobody updated is the one that
 * ships. So the chips compose the text and the text is what is stored — the
 * textarea is always there, always editable, and always the record.
 *
 * ── No cap ─────────────────────────────────────────────────────────────────
 * The reference stops at six adjectives. §14.4 caps nothing, and a Founder with
 * a seventh word would be refused by a number nobody agreed to (§1 rule 6).
 */

import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { Button, Field, Input, Textarea } from '../../components/index.js';
import { BuildStepPage, buildStepNav } from './BuildStepPage.js';
import { useBuildFlow } from './useBuild.js';

/**
 * The reference's own list, kept.
 *
 * `Trustworthy` stays: §3.2's ban is on `trust` as in *held in trust*, the
 * scanner is word-bounded, and a brand adjective is not a custody claim. It is
 * recorded here so a later session does not "fix" it.
 */
const SUGGESTIONS = [
  'Fun',
  'Regal',
  'Professional',
  'Affordable',
  'Trustworthy',
  'Quirky',
  'Visionary',
  'Provocative',
  'Human',
  'Caring',
  'Confident',
  'Friendly',
] as const;

export function VoiceStep() {
  const { campaignId = '' } = useParams();
  const build = useBuildFlow(campaignId);
  const [text, setText] = useState<string | null>(null);
  const [custom, setCustom] = useState('');

  const value = text ?? build.state?.build?.brandVoice ?? '';

  const write = useCallback(
    (next: string) => {
      setText(next);
      build.autosave.queue({ brandVoice: next });
    },
    [build.autosave],
  );

  // Which suggestions are already in the text. A word-bounded match, so
  // "Confident" does not light up because somebody wrote "confidently".
  const chosen = useMemo(() => {
    const lower = value.toLowerCase();
    return new Set(
      SUGGESTIONS.filter((word) => new RegExp(`\\b${word.toLowerCase()}\\b`).test(lower)),
    );
  }, [value]);

  const add = useCallback(
    (word: string) => {
      const trimmed = word.trim();
      if (!trimmed) return;
      if (new RegExp(`\\b${trimmed.toLowerCase()}\\b`).test(value.toLowerCase())) return;
      write(value.trim() ? `${value.replace(/[\s,]+$/, '')}, ${trimmed}` : trimmed);
    },
    [value, write],
  );

  return (
    <BuildStepPage
      pageId="voice"
      campaignId={campaignId}
      build={build}
      title="How should your campaign sound?"
      lede="A few words a stranger could use to describe your brand, plus anything else worth knowing. A reviewer and a Creator both read this."
    >
      <div className="ff-voice">
        <p className="ff-voice__label" id="ff-voice-suggestions">
          Tap one to add it, or write your own.
        </p>
        <div className="ff-voice__chips" role="group" aria-labelledby="ff-voice-suggestions">
          {SUGGESTIONS.map((word) => {
            const on = chosen.has(word);
            return (
              <button
                type="button"
                key={word}
                className={on ? 'ff-voice__chip is-on' : 'ff-voice__chip'}
                aria-pressed={on}
                onClick={() => add(word)}
              >
                {word}
              </button>
            );
          })}
        </div>

        <div className="ff-voice__custom">
          <Field label="A word of your own" id="ff-voice-custom">
            <Input
              value={custom}
              onChange={(e) => setCustom(e.currentTarget.value)}
              placeholder="Unhurried"
            />
          </Field>
          <Button
            tier="secondary"
            small
            onClick={() => {
              add(custom);
              setCustom('');
            }}
            disabled={custom.trim().length === 0}
          >
            Add this word
          </Button>
        </div>

        {/* The record. Everything above composes into it; nothing above is
            stored separately, so there is no second answer to drift. */}
        <Field
          label="Your brand voice"
          id="ff-voice-text"
          hint="This is what is saved. Edit it however you like — the words above are only a way in."
        >
          <Textarea
            value={value}
            rows={6}
            onChange={(e) => write(e.currentTarget.value)}
          />
        </Field>
      </div>

      {buildStepNav(build, 'voice')}
    </BuildStepPage>
  );
}
