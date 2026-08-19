/**
 * Screen 23 — your FAQs — Founder Flow v2, Session F.
 *
 * `campaign_faqs`, through the authoring route that shipped with
 * campaign-page-v2 on 2026-08-18. The reference draws a form on the left and a
 * live preview on the right; the preview is real here — it renders the same
 * question and answer the public page will, from the same values.
 *
 * ── An FAQ answer is a column-one field, and §20 names the loophole ─────────
 * A Founder editing "when will I get it?" must not effectively move a delivery
 * date. `commitmentsIn` already decides that at the live-editing door, which is
 * where it binds — a campaign in build has not published anything yet, so an
 * answer written here is reviewed with the rest of the build (§15). The point
 * is only that this surface is not a second writer: it calls `saveFaq`, the
 * same route `/campaigns/:campaignId/build` calls.
 */

import { useCallback, useState } from 'react';
import { useParams } from 'react-router';
import { Button, Field, Input, Textarea } from '../../components/index.js';
import { BuildStepPage, buildStepNav } from './BuildStepPage.js';
import { useBuildFlow } from './useBuild.js';
import { removeFaq, saveFaq } from '../founder/api.js';

export function FaqsStep() {
  const { campaignId = '' } = useParams();
  const build = useBuildFlow(campaignId);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const faqs = build.state?.faqs ?? [];

  const add = useCallback(async () => {
    if (!question.trim() || !answer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await saveFaq(campaignId, { question: question.trim(), answer: answer.trim() });
      await build.refresh();
      setQuestion('');
      setAnswer('');
    } catch {
      setError('We could not save that question. Nothing has changed.');
    } finally {
      setBusy(false);
    }
  }, [answer, build, campaignId, question]);

  const drop = useCallback(
    async (faqId: string) => {
      setBusy(true);
      try {
        await removeFaq(campaignId, faqId);
        await build.refresh();
      } catch {
        setError('We could not remove that question.');
      } finally {
        setBusy(false);
      }
    },
    [build, campaignId],
  );

  return (
    <BuildStepPage
      pageId="faqs"
      campaignId={campaignId}
      build={build}
      title="What will people ask?"
      lede="The questions somebody asks before they pre-order, answered in your words. They appear on your public page exactly as you write them."
    >
      <div className="ff-faq">
        <div className="ff-faq__form">
          <Field label="The question" id="ff-faq-q">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.currentTarget.value)}
              placeholder="When will I get it?"
            />
          </Field>
          <Field label="Your answer" id="ff-faq-a">
            <Textarea
              value={answer}
              rows={5}
              onChange={(e) => setAnswer(e.currentTarget.value)}
            />
          </Field>
          <Button
            tier="secondary"
            onClick={() => void add()}
            disabled={busy || !question.trim() || !answer.trim()}
          >
            {busy ? 'Saving…' : 'Add this question'}
          </Button>
          {error ? (
            <div className="notice notice--warn" role="alert">
              <p>{error}</p>
            </div>
          ) : null}
        </div>

        {/* The preview, from the same values the public page renders. */}
        <div className="ff-faq__preview">
          <p className="ff-faq__preview-label">On your campaign page</p>
          {question.trim() || answer.trim() ? (
            <div className="ff-faq__card">
              <p className="ff-faq__q">{question.trim() || 'Your question'}</p>
              <p className="ff-faq__a">{answer.trim() || 'Your answer appears here.'}</p>
            </div>
          ) : faqs.length === 0 ? (
            <p className="ff-faq__empty">
              Nothing yet. What you write on the left appears here as you type.
            </p>
          ) : null}

          {faqs.map((faq) => (
            <div className="ff-faq__card" key={faq.id}>
              <p className="ff-faq__q">{faq.question}</p>
              <p className="ff-faq__a">{faq.answer}</p>
              <Button tier="tertiary" small onClick={() => void drop(faq.id)} disabled={busy}>
                Remove this question
              </Button>
            </div>
          ))}
        </div>
      </div>

      {buildStepNav(build, 'faqs')}
    </BuildStepPage>
  );
}
