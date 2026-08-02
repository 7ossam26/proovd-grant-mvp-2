/**
 * The Founder's updates surface — Spec §18 (Phase 14c).
 *
 * The Founder posts updates on a live (or naturally closed) campaign and sees
 * the ones already posted. §18: Product allows general/public or Backer-only;
 * Idea adds milestone/progress; a material delivery change carries the previous
 * and revised commitment together. The server owns those rules — this surface
 * only offers the audiences the server says the campaign allows and shows the
 * server's refusal in plain words.
 *
 * There is no card, no money, and no Backer here: updates are informational, and
 * the Backer's view of Backer-only updates lives on their magic-link page
 * (Phase 15). This surface collects text and two optional media links.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { UPDATE_AUDIENCE_LABELS, updateAudienceAllowed, type UpdateAudience } from '@proovd/shared';
import {
  Button,
  Card,
  Field,
  Input,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Tag,
  Textarea,
  Toggle,
} from '../../components/index.js';
import { supportMailto } from '../../features/public/states.js';
import {
  fetchUpdates,
  postUpdate,
  FounderRequestError,
  type FounderUpdatesView,
  type FounderUpdate,
  type PostUpdateBody,
} from './api.js';

const AUDIENCE_OPTIONS: UpdateAudience[] = ['general_public', 'backer_only', 'milestone_progress'];

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
}

interface Draft {
  audience: UpdateAudience;
  title: string;
  body: string;
  imageUrl: string;
  videoUrl: string;
  deliveryChange: boolean;
  prior: string;
  revised: string;
}

const EMPTY_DRAFT: Draft = {
  audience: 'general_public',
  title: '',
  body: '',
  imageUrl: '',
  videoUrl: '',
  deliveryChange: false,
  prior: '',
  revised: '',
};

export function CampaignUpdates() {
  const { campaignId = '' } = useParams();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; view: FounderUpdatesView }
  >({ status: 'loading' });
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  async function load() {
    try {
      const view = await fetchUpdates(campaignId);
      setState({ status: 'ready', view });
    } catch (caught) {
      setState({
        status: 'error',
        message:
          caught instanceof FounderRequestError
            ? (caught.detail.whatHappened ?? 'The updates could not be loaded.')
            : 'The updates could not be loaded.',
      });
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  async function submit() {
    setPosting(true);
    setPostError(null);
    try {
      const payload: PostUpdateBody = {
        audience: draft.audience,
        body: draft.body,
        ...(draft.title.trim() ? { title: draft.title } : {}),
        ...(draft.imageUrl.trim() ? { imageUrl: draft.imageUrl } : {}),
        ...(draft.videoUrl.trim() ? { videoUrl: draft.videoUrl } : {}),
        ...(draft.deliveryChange ? { deliveryChange: { prior: draft.prior, revised: draft.revised } } : {}),
      };
      await postUpdate(campaignId, payload);
      setDraft(EMPTY_DRAFT);
      await load();
    } catch (caught) {
      setPostError(
        caught instanceof FounderRequestError
          ? (caught.detail.whatHappened ?? 'The update could not be posted.')
          : 'The update could not be posted.',
      );
    } finally {
      setPosting(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <Measure>
        <StatePanel
          state="Loading your updates"
          whatHappened="Proovd is fetching the updates you have posted."
          next="They appear in a moment."
          owner="Proovd"
          nextUpdate="Within a few seconds"
          action={NO_ACTION}
          reference={campaignId}
        />
      </Measure>
    );
  }

  if (state.status === 'error') {
    return (
      <Measure>
        <StatePanel
          state="Updates could not be loaded"
          whatHappened={state.message}
          next="Reload to try again."
          owner="Proovd"
          nextUpdate="When you reload"
          action={NO_ACTION}
          reference={campaignId}
          getHelp={{ href: supportMailto(`Updates — ${campaignId}`) }}
        />
      </Measure>
    );
  }

  const { view } = state;
  const allowed = AUDIENCE_OPTIONS.filter((a) => updateAudienceAllowed(view.model, a));

  return (
    <Measure>
      <Section>
        <Tag variant="mint">Updates</Tag>
        <h1>Post an update</h1>
        <p className="field-hint">
          Updates are refresh-based and informational. Public updates appear on your campaign page;
          Backers-only updates appear on each Backer&rsquo;s page. Nothing here is a charge.
        </p>
      </Section>

      {view.canPost ? (
        <Card>
          <h2>New update</h2>
          <Field label="Audience">
            <select
              className="pv-select"
              value={draft.audience}
              onChange={(e) => setDraft({ ...draft, audience: e.target.value as UpdateAudience })}
            >
              {allowed.map((a) => (
                <option key={a} value={a}>
                  {UPDATE_AUDIENCE_LABELS[a]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title (optional)">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Update">
            <Textarea
              rows={5}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </Field>
          <Field label="Image link (optional)">
            <Input
              inputMode="url"
              placeholder="https://…"
              value={draft.imageUrl}
              onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
            />
          </Field>
          <Field label="Video link (optional)">
            <Input
              inputMode="url"
              placeholder="https://…"
              value={draft.videoUrl}
              onChange={(e) => setDraft({ ...draft, videoUrl: e.target.value })}
            />
          </Field>

          <Toggle
            label="This update announces a change to delivery"
            checked={draft.deliveryChange}
            onCheckedChange={(v) => setDraft({ ...draft, deliveryChange: v })}
          />
          {draft.deliveryChange ? (
            <>
              <p className="field-hint">
                A delivery change shows the previous and the revised commitment together, so Backers
                see exactly what changed.
              </p>
              <Field label="Previous commitment">
                <Input value={draft.prior} onChange={(e) => setDraft({ ...draft, prior: e.target.value })} />
              </Field>
              <Field label="Revised commitment">
                <Input value={draft.revised} onChange={(e) => setDraft({ ...draft, revised: e.target.value })} />
              </Field>
            </>
          ) : null}

          {postError ? <p className="field-error" role="alert">{postError}</p> : null}
          <Button tier="primary" onClick={() => void submit()} disabled={posting || draft.body.trim().length === 0}>
            {posting ? 'Posting…' : 'Post update'}
          </Button>
        </Card>
      ) : (
        <Card>
          <StatePanel
            state="Updates open when your campaign launches"
            whatHappened="You can post updates once your campaign is live. It is not live yet."
            next="Come back after launch — you can keep posting after the campaign closes, too."
            owner="Proovd"
            nextUpdate="At launch"
            action={NO_ACTION}
            reference={campaignId}
          />
        </Card>
      )}

      <Section>
        <h2 className="h2">Posted updates</h2>
        {view.updates.length === 0 ? (
          <p className="field-hint">You haven&rsquo;t posted any updates yet.</p>
        ) : (
          <div className="update-list">
            {view.updates.map((u) => (
              <FounderUpdateEntry key={u.id} update={u} />
            ))}
          </div>
        )}
      </Section>
    </Measure>
  );
}

function FounderUpdateEntry({ update }: { update: FounderUpdate }) {
  return (
    <Card className="update">
      <p className="update__meta">
        <span className="update__audience">{UPDATE_AUDIENCE_LABELS[update.audience]}</span>
        <span>{formatWhen(update.publishedAt)}</span>
      </p>
      {update.title ? <h3 className="update__title">{update.title}</h3> : null}
      {update.isMaterialDeliveryChange && update.priorCommitment && update.revisedCommitment ? (
        <dl className="update__change">
          <div className="update__change-row">
            <dt>Previously</dt>
            <dd>{update.priorCommitment}</dd>
          </div>
          <div className="update__change-row">
            <dt>Now</dt>
            <dd>{update.revisedCommitment}</dd>
          </div>
        </dl>
      ) : null}
      {update.body.split('\n\n').map((p) => (
        <p key={p.slice(0, 40)}>{p}</p>
      ))}
    </Card>
  );
}
