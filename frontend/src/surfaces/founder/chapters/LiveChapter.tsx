/**
 * Chapter 2, Live — Founder Dashboard Session D.
 *
 * The campaign is running. §20's three altitudes — Glance (what is happening),
 * the one ranked Act (the thing to do), Explore (everything else) — plus the
 * three things a Founder may actually WRITE while live: a §20 live edit, a §18
 * update, and deviation 2's acknowledgement of a Creator's post.
 *
 * ── One render, one receipt (§33.6.6) ──────────────────────────────────────
 * `GET .../home` issues a `campaign_home_deliveries` row carrying the count it
 * rendered, and `POST .../home/seen` is the only thing that advances last-seen.
 * So this chapter fetches `home` EXACTLY ONCE, when it mounts, and every later
 * refresh — after posting an update, after an edit, after an acknowledgement —
 * goes through `GET .../home/explore` or the surface's own read. A chapter that
 * re-fetched `home` after each mutation would mint a receipt per click, and the
 * Founder's "+N since you left" would silently reset to zero mid-session.
 *
 * The acknowledgement itself is sent from an effect that runs AFTER React has
 * committed this tree: a render that threw never reaches it, the receipt stays
 * open, and the delta survives to be read again.
 *
 * ── The numbers are permitted; the ranking is not ──────────────────────────
 * §30 defers public leaderboards. The supplied reference's Creator screen is an
 * `h1` reading "Farah Nassar is leading.", #1–#6 badges, a three-place podium
 * with a `Top` tag, and a list sorted by backers — four ranking mechanisms, and
 * removing the crown while keeping the sort is still one. `explore.ts` states
 * its order (alphabetical by handle, transparently not a metric) and nothing
 * here re-sorts, numbers, or compares.
 *
 * ── The hero is a count, not money ─────────────────────────────────────────
 * §20 names Glance's one large number: the active pre-order count. The
 * reference's hero is `$12,840 Money made`, which during a live campaign is
 * false — capture is §21's close batch and nothing has moved — and it is the
 * saved-card/charge confusion §30 forbids in the place §20 legislates against
 * by requiring the permanent not-yet-charged clarification. The totals are in
 * Explore, where they carry `charged: false` and the sentence that says so.
 *
 * ── One edit route, and the field decides what it does ─────────────────────
 * §20's three tiers are a property of the FIELD (§15: materiality is an Admin
 * judgement recorded with its reason, never the Founder's opinion of their own
 * edit). So this surface sends the field and the value to `POST .../live-edit`
 * and renders whatever comes back: applied, routed to review, or refused. There
 * is no tier in the request, no second route, and no control that could pick
 * one — which is what makes §33.6.12's "material edits cannot publish directly"
 * structural rather than a promise about behaviour.
 *
 * ── The panels are inline rather than modal ────────────────────────────────
 * Session C's reasoning, unchanged: every form here can be refused by the
 * server, and `Modal` closes on its own primary action, which would put the
 * refusal on a card behind a panel that has just vanished.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACT_CAUGHT_UP,
  ACKNOWLEDGEMENT_IS_ONE_WAY,
  ACKNOWLEDGEMENT_NOT_WHILE_UNDER_CORRECTION,
  COMMITMENT_ROUTES_TO_REVIEW,
  EDIT_TIER_GROUPS,
  FRESHNESS_IS_A_READ_TIME,
  LIVE_ABSENCES,
  RESERVED_IS_NOT_RAISED,
  TIER_IS_A_PROPERTY_OF_THE_FIELD,
  UPDATE_AUDIENCE_LABELS,
  editTierGroup,
  liveAbsence,
  resolveCaughtUp,
  resolveDelta,
  resolveFreshness,
  resolveProgress,
  updateAudienceAllowed,
  type EditTier,
  type UpdateAudience,
} from '@proovd/shared';
import {
  Accordion,
  Button,
  Card,
  Copylink,
  Field,
  Input,
  Link,
  Measure,
  NO_ACTION,
  Section,
  StatePanel,
  Stat,
  Tag,
  Textarea,
  Toggle,
} from '../../../components/index.js';
import { SurfaceLoading, supportMailto } from '../../../features/public/states.js';
import {
  acknowledgeCreatorPost,
  acknowledgeHomeDelivery,
  applyLiveEdit,
  fetchBuild,
  fetchCampaignHome,
  fetchCreatorPosts,
  fetchEditableFields,
  fetchExplore,
  fetchLiveEditHistory,
  fetchUpdates,
  postUpdate,
  FounderRequestError,
  type ActCandidate,
  type BuildState,
  type CampaignHomeView,
  type CreatorPostView,
  type EditableFieldView,
  type ExploreSection,
  type ExploreView,
  type FounderUpdate,
  type FounderUpdatesView,
  type LiveEditHistory,
  type PostUpdateBody,
} from '../api.js';

/* ── Small shared helpers ─────────────────────────────────────────────────── */

/** §27.1: local time, with UTC beside it where the moment is a deadline. */
function localMoment(iso: string | null): string {
  if (!iso) return 'the scheduled close';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
}

function localDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function refusalText(caught: unknown, fallback: string): string {
  return caught instanceof FounderRequestError
    ? (caught.detail.whatHappened ?? fallback)
    : 'The request did not complete. Nothing was changed.';
}

/** The register's own sentence, where the reference put a control. */
function Absence({ id }: { id: string }) {
  return <p className="fd-absence">{liveAbsence(id).sentence}</p>;
}

/* ── The chapter ──────────────────────────────────────────────────────────── */

export function LiveChapter({ campaignId }: { campaignId: string }) {
  const [home, setHome] = useState<CampaignHomeView | null>(null);
  const [explore, setExplore] = useState<ExploreView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /** Receipts already acknowledged in this session — an ack happens once. */
  const acknowledged = useRef<Set<string>>(new Set());

  /*
    ONE `home` read, on mount. §33.6.6: it mints the delivery receipt, so every
    later refresh in this chapter goes to `explore` instead — the route Phase
    17a built for exactly this and which had no caller until now.
  */
  useEffect(() => {
    let live = true;
    fetchCampaignHome(campaignId)
      .then((result) => {
        if (!live) return;
        setHome(result.home);
        setExplore(result.home.explore);
      })
      .catch((caught: unknown) => {
        if (live) setFailure(refusalText(caught, 'Your campaign home could not be loaded.'));
      });
    return () => {
      live = false;
    };
  }, [campaignId]);

  /**
   * §33.6.6. Runs only after React committed a successful render of this tree.
   *
   * A render that threw never reaches here, so the receipt stays open and the
   * next visit computes the same delta from the same unmoved position. The
   * acknowledgement failing is deliberately silent: it costs one repeated
   * delta, which is the safe direction, and there is nothing to be done about
   * it from here.
   */
  useEffect(() => {
    if (!home) return;
    const deliveryId = home.glance.deliveryId;
    if (acknowledged.current.has(deliveryId)) return;
    acknowledged.current.add(deliveryId);
    void acknowledgeHomeDelivery(campaignId, deliveryId).catch(() => {
      /* The delta survives. See above. */
    });
  }, [home, campaignId]);

  /** The refresh every mutation uses. Never re-reads `home` (see the header). */
  const refreshExplore = useCallback(async () => {
    try {
      const result = await fetchExplore(campaignId);
      setExplore(result.explore);
    } catch {
      /* Explore is supporting data; a failed refresh leaves the last read up. */
    }
  }, [campaignId]);

  if (failure) {
    return (
      <Section aria-labelledby="fd-live-error">
        <Measure>
          <h1 className="h2" id="fd-live-error">
            We could not load your campaign
          </h1>
          <StatePanel
            state="We could not load your campaign"
            whatHappened={failure}
            next="Reload the page. Nothing about your campaign has changed."
            owner="Proovd"
            nextUpdate="As soon as you reload"
            action={NO_ACTION}
            reference={campaignId}
            getHelp={{ href: supportMailto(`Campaign home — ${campaignId}`) }}
          />
        </Measure>
      </Section>
    );
  }

  if (!home) return <SurfaceLoading subject="your campaign" reference={campaignId} />;

  return (
    <Section aria-labelledby="fd-live-title">
      <Measure>
        <p className="kicker">Live campaign</p>
        {/*
          §33.11.2: every principal surface names itself once, at level one. The
          Glance number is the hero (DNA §5.1), and a hero is not a title — a
          Founder arriving from a bookmark, and every screen reader, is told
          which page this is before the count means anything.
        */}
        <h1 className="h2" id="fd-live-title">
          Your campaign today
        </h1>

        <GlancePanel home={home} campaignId={campaignId} />
        <ActPanel act={home.act} />

        <PagePanel campaignId={campaignId} campaignStatus={home.status} />
        <UpdatesPanel campaignId={campaignId} onPosted={refreshExplore} />
        <PostsPanel campaignId={campaignId} />
        <ExplorePanel explore={explore ?? home.explore} />

        {home.milestoneHistory.length > 0 ? (
          <MilestoneHistory entries={home.milestoneHistory} />
        ) : null}

        <p className="quiet">
          {resolveFreshness(clockTime(home.glance.readAt))} · {FRESHNESS_IS_A_READ_TIME}
        </p>
      </Measure>
    </Section>
  );
}

/* ── Glance ───────────────────────────────────────────────────────────────── */

function GlancePanel({ home, campaignId }: { home: CampaignHomeView; campaignId: string }) {
  const { glance } = home;

  // §20's two progress lines. The shared resolver throws on an unfilled marker
  // and refuses a Product campaign carrying a threshold remainder (§14.4's "no
  // public funding gate") — so a wrong shape is a loud failure, not a wrong page.
  const progress = resolveProgress({
    model: glance.model,
    localCloseLabel: localMoment(glance.closesAt),
    ...(glance.model === 'idea' && glance.remainingToThreshold !== null
      ? { remainingToThreshold: glance.remainingToThreshold }
      : {}),
  });

  return (
    <Card className="fd-live__glance">
      <Stat variant="white" brandValue value={glance.activePreorderCount} sub="active pre-orders" />

      <p>
        {glance.delta
          ? resolveDelta(glance.delta.count, localDate(glance.delta.since))
          : 'This is your first visit to this page.'}
      </p>

      <p>{progress}</p>

      {/*
        §20's permanent clarification. Not dismissible, not a tooltip, and not
        below a fold — §30 forbids anything that confuses a saved card with a
        charge, and a large number with no qualifier is exactly that.
      */}
      <p className="notice">{glance.notYetChargedNotice}</p>

      {/* §20: "Current Creator liveness only when true." Null renders nothing —
          a zero would be a stated fact about an empty roster (§1.4). */}
      {glance.activeCreators !== null ? (
        <p>
          <Tag variant="mint">
            {glance.activeCreators} Creator{glance.activeCreators === 1 ? '' : 's'} currently active
          </Tag>
        </p>
      ) : null}

      {/*
        The campaign's OWN address. The reference's copy control hands over a
        `/c/…` link, which is §18's per-Creator tracking-link ingest — sharing
        one would credit a Creator for people the Founder brought in themselves.
      */}
      {/*
        `display` matters at 320. `.copylink__url` ellipsises a long value and
        `min-width: 0` lets it shrink — but the copy button is a flex item too,
        and `.btn` is `overflow: hidden` for the fill sweep, so a raw URL
        squeezed it until it clipped its own label by 8px. Every other call site
        in the product already passes a short label; the browser pass is what
        caught this one not doing it.
      */}
      <Copylink
        url={`${window.location.origin}/campaign/${campaignId}`}
        display="Your campaign link"
      />
      <Absence id="creator_tracking_link" />
    </Card>
  );
}

/* ── Act ──────────────────────────────────────────────────────────────────── */

function ActPanel({ act }: { act: CampaignHomeView['act'] }) {
  if (act.state === 'caught_up') {
    // DNA §5.4's done-moment. One sentence, no button, and nothing here that
    // could invent one — §20: "show no manufactured CTA."
    return (
      <Card className="fd-live__act">
        <p className="lede">{resolveCaughtUp(localMoment(act.closesAt))}</p>
      </Card>
    );
  }

  return (
    <Card className="fd-live__act">
      <p className="kicker">One thing needs you</p>
      <h2 className="h3">{act.action.label}</h2>
      <p>{act.action.detail}</p>

      {act.overridden && act.override ? (
        <p className="quiet">Shown first by a recorded safety decision: {act.override.reason}</p>
      ) : null}

      {/* DNA §5.6: one hero. Everything else is deferred, not competing. */}
      <Button tier="primary" href={act.action.href}>
        {act.action.label}
      </Button>

      {act.deferred.length > 0 ? <DeferredActions actions={act.deferred} /> : null}
    </Card>
  );
}

function DeferredActions({ actions }: { actions: ActCandidate[] }) {
  return (
    <Accordion
      items={[
        {
          value: 'deferred',
          head: `${actions.length} other thing${actions.length === 1 ? '' : 's'} waiting`,
          body: (
            <ul className="doc-list">
              {actions.map((action) => (
                <li key={`${action.sourceTable}:${action.sourceId}`}>
                  <Link href={action.href}>{action.label}</Link> — {action.detail}
                </li>
              ))}
            </ul>
          ),
        },
      ]}
    />
  );
}

/* ── D2: your page, and §20's three tiers ─────────────────────────────────── */

/** The rows a non-`build` surface needs a target for, taken from the build read. */
function targetsFor(
  surface: EditableFieldView['surface'],
  build: BuildState | null,
): { id: string; label: string }[] {
  if (!build) return [];
  switch (surface) {
    case 'faq':
      return build.faqs.map((f) => ({ id: f.id, label: f.question }));
    case 'reward_package':
      return build.rewardPackages.map((r) => ({ id: r.id, label: r.title }));
    case 'demo_moment':
      return build.demoMoments.map((d) => ({ id: d.id, label: d.momentLabel }));
    case 'benefit_card':
      return build.benefitCards.map((b) => ({ id: b.id, label: b.title }));
    default:
      return [];
  }
}

function PagePanel({
  campaignId,
  campaignStatus,
}: {
  campaignId: string;
  campaignStatus: string;
}) {
  const [fields, setFields] = useState<EditableFieldView[] | null>(null);
  const [build, setBuild] = useState<BuildState | null>(null);
  const [history, setHistory] = useState<LiveEditHistory | null>(null);

  const [chosen, setChosen] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');
  const [value, setValue] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [fieldResult, buildResult, historyResult] = await Promise.all([
      fetchEditableFields(campaignId),
      fetchBuild(campaignId),
      fetchLiveEditHistory(campaignId),
    ]);
    setFields(fieldResult.fields);
    setBuild(buildResult);
    setHistory(historyResult);
  }, [campaignId]);

  useEffect(() => {
    void load().catch(() => setRefusal('The editable parts of your page could not be loaded.'));
  }, [load]);

  if (!fields) {
    return (
      <Card className="fd-live__page">
        <h2 className="h3">Your page</h2>
        <p className="quiet">Reading what you can change…</p>
      </Card>
    );
  }

  // A field is identified by (surface, field) — `title` exists on both `build`
  // and `benefit_card`, so a bare field name is ambiguous.
  const selected = fields.find((f) => `${f.surface}:${f.field}` === chosen) ?? null;
  const tier: EditTier | null = selected?.tier ?? null;
  const targets = selected ? targetsFor(selected.surface, build) : [];
  const needsTarget = targets.length > 0;
  const needsReason = tier === 'requires_review';

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setRefusal(null);
    setOutcome(null);
    try {
      /*
        No tier in the body. The server looks the field up and decides — see the
        module header. A `never_direct` field is not offered here at all, and
        the route refuses it independently if one is ever posted (§1.1).
      */
      const result = await applyLiveEdit(campaignId, {
        surface: selected.surface,
        field: selected.field,
        value,
        ...(needsTarget && targetId ? { targetId } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });

      if (result.tier === 'direct_versioned') {
        setOutcome('That is on your page now. The previous version is kept.');
      } else if (result.redirectedBy) {
        setOutcome(COMMITMENT_ROUTES_TO_REVIEW);
      } else {
        setOutcome('Proovd has it. You will hear when it is decided.');
      }
      setValue('');
      setReason('');
      await load();
    } catch (caught) {
      setRefusal(refusalText(caught, 'That change was not applied.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="fd-live__page">
      <h2 className="h3">Your page</h2>
      <p className="fd-note">{TIER_IS_A_PROPERTY_OF_THE_FIELD}</p>

      <Field label="What do you want to change?">
        <select
          className="pv-select"
          value={chosen}
          onChange={(event) => {
            setChosen(event.target.value);
            setTargetId('');
            setValue('');
            setReason('');
            setOutcome(null);
            setRefusal(null);
          }}
        >
          <option value="">Pick a part of your page</option>
          {EDIT_TIER_GROUPS.map((group) => (
            <optgroup key={group.tier} label={group.label}>
              {fields
                .filter((f) => f.tier === group.tier)
                .map((f) => (
                  <option key={`${f.surface}:${f.field}`} value={`${f.surface}:${f.field}`}>
                    {f.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </Field>

      {selected ? (
        <div className="fd-live__edit">
          <p className="fd-note">{editTierGroup(selected.tier).explainer}</p>

          {selected.tier === 'never_direct' ? (
            /*
              §20's third column. The refusal is rendered where the control
              would have been and NOTHING is opened — no request, no draft. The
              route refuses independently, and a test drives it there to prove
              no `campaign_change_requests` row appears.
            */
            <p className="fd-absence">{selected.reason}</p>
          ) : (
            <>
              {needsTarget ? (
                <Field label="Which one?">
                  <select
                    className="pv-select"
                    value={targetId}
                    onChange={(event) => setTargetId(event.target.value)}
                  >
                    <option value="">Pick one</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              <Field label={`New ${selected.label.toLowerCase()}`}>
                <Textarea
                  rows={4}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </Field>

              {needsReason ? (
                <Field label="Why are you changing it?">
                  <Input value={reason} onChange={(event) => setReason(event.target.value)} />
                </Field>
              ) : null}

              <Button
                tier="primary"
                disabled={
                  busy ||
                  value.trim().length === 0 ||
                  (needsTarget && !targetId) ||
                  (needsReason && reason.trim().length === 0)
                }
                onClick={() => void submit()}
              >
                {selected.tier === 'requires_review' ? 'Send it to Proovd' : 'Save the change'}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {outcome ? (
        <p className="field-hint" role="status">
          {outcome}
        </p>
      ) : null}
      {refusal ? (
        <p className="field-error" role="alert">
          {refusal}
        </p>
      ) : null}

      <Absence id="page_visual_upload" />

      {history && (history.edits.length > 0 || history.requests.length > 0) ? (
        <Accordion
          items={[
            {
              value: 'history',
              head: 'Everything you have changed',
              body: (
                <ul className="doc-list">
                  {history.requests.map((request) => (
                    <li key={request.id}>
                      <strong>{request.field}</strong> — with Proovd ({request.status})
                      {request.decisionReason ? ` · ${request.decisionReason}` : ''}
                    </li>
                  ))}
                  {history.edits.map((edit) => (
                    <li key={edit.id}>
                      <strong>{edit.field}</strong> — changed {localDate(edit.occurredAt)}
                    </li>
                  ))}
                </ul>
              ),
            },
          ]}
        />
      ) : null}

      {/* §20's tiers apply while a campaign is live; the build surface owns it
          before that, and the server says so in the same words. */}
      {campaignStatus === 'live' ? null : (
        <p className="quiet">
          Your campaign is not running right now, so changes go through your build.
        </p>
      )}
    </Card>
  );
}

/* ── D3: updates (§18) ────────────────────────────────────────────────────── */

const AUDIENCE_OPTIONS: UpdateAudience[] = ['general_public', 'backer_only', 'milestone_progress'];

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

function UpdatesPanel({
  campaignId,
  onPosted,
}: {
  campaignId: string;
  onPosted: () => Promise<void>;
}) {
  const [view, setView] = useState<FounderUpdatesView | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const load = useCallback(async () => {
    setView(await fetchUpdates(campaignId));
  }, [campaignId]);

  useEffect(() => {
    void load().catch(() => setRefusal('Your updates could not be loaded.'));
  }, [load]);

  async function submit() {
    setBusy(true);
    setRefusal(null);
    try {
      const payload: PostUpdateBody = {
        audience: draft.audience,
        body: draft.body,
        ...(draft.title.trim() ? { title: draft.title } : {}),
        ...(draft.imageUrl.trim() ? { imageUrl: draft.imageUrl } : {}),
        ...(draft.videoUrl.trim() ? { videoUrl: draft.videoUrl } : {}),
        ...(draft.deliveryChange
          ? { deliveryChange: { prior: draft.prior, revised: draft.revised } }
          : {}),
      };
      await postUpdate(campaignId, payload);
      setDraft(EMPTY_DRAFT);
      await load();
      // Explore's `comments_and_updates` count moved. `home` is deliberately
      // NOT re-read: that would mint a second §33.6.6 receipt (see the header).
      await onPosted();
    } catch (caught) {
      setRefusal(refusalText(caught, 'The update could not be posted.'));
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <Card className="fd-live__updates">
        <h2 className="h3">Updates</h2>
        <p className="quiet">Reading your updates…</p>
      </Card>
    );
  }

  // §18's per-model rule is the server's; this offers only what it allows.
  const allowed = AUDIENCE_OPTIONS.filter((a) => updateAudienceAllowed(view.model, a));

  return (
    <Card className="fd-live__updates">
      <h2 className="h3">Updates</h2>

      {view.canPost ? (
        <>
          <Field label="Who sees this?">
            <select
              className="pv-select"
              value={draft.audience}
              onChange={(event) =>
                setDraft({ ...draft, audience: event.target.value as UpdateAudience })
              }
            >
              {allowed.map((audience) => (
                <option key={audience} value={audience}>
                  {UPDATE_AUDIENCE_LABELS[audience]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title (optional)">
            <Input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </Field>
          <Field label="Update">
            <Textarea
              rows={5}
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </Field>
          <Field label="Image link (optional)">
            <Input
              inputMode="url"
              placeholder="https://…"
              value={draft.imageUrl}
              onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })}
            />
          </Field>
          <Field label="Video link (optional)">
            <Input
              inputMode="url"
              placeholder="https://…"
              value={draft.videoUrl}
              onChange={(event) => setDraft({ ...draft, videoUrl: event.target.value })}
            />
          </Field>

          <Toggle
            label="This update announces a change to delivery"
            checked={draft.deliveryChange}
            onCheckedChange={(next) => setDraft({ ...draft, deliveryChange: next })}
          />
          {draft.deliveryChange ? (
            <>
              <p className="fd-note">
                A delivery change shows the previous and the revised commitment together, so
                Backers see exactly what changed.
              </p>
              <Field label="Previous commitment">
                <Input
                  value={draft.prior}
                  onChange={(event) => setDraft({ ...draft, prior: event.target.value })}
                />
              </Field>
              <Field label="Revised commitment">
                <Input
                  value={draft.revised}
                  onChange={(event) => setDraft({ ...draft, revised: event.target.value })}
                />
              </Field>
            </>
          ) : null}

          {refusal ? (
            <p className="field-error" role="alert">
              {refusal}
            </p>
          ) : null}
          <Button
            tier="primary"
            disabled={busy || draft.body.trim().length === 0}
            onClick={() => void submit()}
          >
            {busy ? 'Posting…' : 'Post update'}
          </Button>
        </>
      ) : (
        <StatePanel
          state="Updates open when your campaign launches"
          whatHappened="You can post updates once your campaign is live. It is not live yet."
          next="Come back after launch — you can keep posting after the campaign closes, too."
          owner="Proovd"
          nextUpdate="At launch"
          action={NO_ACTION}
          reference={campaignId}
        />
      )}

      {view.updates.length > 0 ? (
        <Accordion
          items={[
            {
              value: 'posted',
              head: `${view.updates.length} posted`,
              body: (
                <div className="fd-live__posted">
                  {view.updates.map((update) => (
                    <UpdateEntry key={update.id} update={update} />
                  ))}
                </div>
              ),
            },
          ]}
        />
      ) : (
        <p className="quiet">You have not posted an update yet.</p>
      )}
    </Card>
  );
}

function UpdateEntry({ update }: { update: FounderUpdate }) {
  return (
    <article className="fd-live__update">
      <p className="fd-live__updatemeta">
        <Tag variant="mint">{UPDATE_AUDIENCE_LABELS[update.audience]}</Tag>
        <span>{localDate(update.publishedAt)}</span>
      </p>
      {update.title ? <h3 className="h4">{update.title}</h3> : null}
      {update.isMaterialDeliveryChange && update.priorCommitment && update.revisedCommitment ? (
        <dl className="fd-live__change">
          <div>
            <dt>Previously</dt>
            <dd>{update.priorCommitment}</dd>
          </div>
          <div>
            <dt>Now</dt>
            <dd>{update.revisedCommitment}</dd>
          </div>
        </dl>
      ) : null}
      {update.body.split('\n\n').map((paragraph) => (
        <p key={paragraph.slice(0, 40)}>{paragraph}</p>
      ))}
    </article>
  );
}

/* ── Deviation 2: the Creators' posts, and the acknowledgement ────────────── */

function PostsPanel({ campaignId }: { campaignId: string }) {
  const [posts, setPosts] = useState<CreatorPostView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchCreatorPosts(campaignId);
    setPosts(result.posts);
  }, [campaignId]);

  useEffect(() => {
    void load().catch(() => setRefusal('The posts could not be loaded.'));
  }, [load]);

  async function acknowledge(submissionId: string) {
    setBusy(submissionId);
    setRefusal(null);
    try {
      await acknowledgeCreatorPost(campaignId, submissionId);
      await load();
    } catch (caught) {
      setRefusal(refusalText(caught, 'That was not sent.'));
    } finally {
      setBusy(null);
    }
  }

  if (!posts) {
    return (
      <Card className="fd-live__posts">
        <h2 className="h3">What your Creators posted</h2>
        <p className="quiet">Reading the posts…</p>
      </Card>
    );
  }

  return (
    <Card className="fd-live__posts">
      <h2 className="h3">What your Creators posted</h2>

      {posts.length === 0 ? (
        <p className="quiet">
          Nothing has been submitted yet. Creators publish and submit their first post after
          launch, and Proovd verifies each one.
        </p>
      ) : (
        <ul className="fd-live__postlist">
          {posts.map((post) => (
            <li key={post.submissionId} className="fd-live__post">
              <p className="fd-live__posthead">
                {/* §11: the public handle, and nothing behind it. */}
                <strong>{post.publicHandle ?? 'A Creator'}</strong>
                <span className="quiet">{localDate(post.submittedAt)}</span>
              </p>
              <p>
                <Link href={post.postUrl}>{post.postUrl}</Link>
              </p>

              {post.acknowledgedAt ? (
                <p className="fd-live__acked">
                  <Tag variant="mint">Acknowledged</Tag>{' '}
                  <span className="quiet">{ACKNOWLEDGEMENT_IS_ONE_WAY}</span>
                </p>
              ) : post.acknowledgeable ? (
                <Button
                  tier="secondary"
                  disabled={busy === post.submissionId}
                  onClick={() => void acknowledge(post.submissionId)}
                >
                  Tell them you saw it
                </Button>
              ) : (
                <p className="fd-absence">{ACKNOWLEDGEMENT_NOT_WHILE_UNDER_CORRECTION}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {refusal ? (
        <p className="field-error" role="alert">
          {refusal}
        </p>
      ) : null}

      {/*
        The register's `acknowledgement_note` sentence IS
        `ACKNOWLEDGEMENT_HAS_NO_MESSAGE`, so rendering both put the same
        paragraph on the panel twice — the duplication Session C's suite caught
        on the meeting panel, repeating here. The absence is the one that says
        where the control would have been, so it is the one that stays.
      */}
      <Absence id="acknowledgement_note" />
      <Absence id="post_issue" />
      <p>
        <Link href="/support">Get help with a post</Link>
      </p>
    </Card>
  );
}

/* ── Explore (§20's eleven sections) ──────────────────────────────────────── */

/**
 * DNA §5.2: Explore is a first-class space, not a bin. Every section states
 * what its numbers count, and a section whose phase has not run says what it is
 * waiting for instead of showing a zero (§1.4).
 */
function ExplorePanel({ explore }: { explore: ExploreView }) {
  return (
    <Card className="fd-live__explore">
      <h2 className="h3">Everything else</h2>
      <p className="fd-note">{RESERVED_IS_NOT_RAISED}</p>

      <Accordion
        items={explore.sections.map((section) => ({
          value: section.key,
          head: section.title,
          body: <ExploreSectionBody section={section} readAt={explore.readAt} />,
        }))}
      />

      {/* The four things the reference puts here that this does not. */}
      <Absence id="creator_leaderboard" />
      <Absence id="money_made" />
      <Absence id="checkout_sentiment" />
      <Absence id="platform_sources" />
    </Card>
  );
}

function ExploreSectionBody({ section, readAt }: { section: ExploreSection; readAt: string }) {
  return (
    <div>
      <p className="quiet">{section.definition}</p>
      {section.awaiting ? <p className="notice">{section.awaiting}</p> : null}
      {section.data ? <ExploreData data={section.data} /> : null}
      <p className="quiet">{resolveFreshness(clockTime(readAt))}</p>
    </div>
  );
}

function ExploreData({ data }: { data: Record<string, unknown> }) {
  return (
    <dl className="fd-live__data">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{renderValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not yet available';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/* ── Milestone history (§20: "then move to history") ──────────────────────── */

function MilestoneHistory({ entries }: { entries: CampaignHomeView['milestoneHistory'] }) {
  return (
    <Accordion
      items={[
        {
          value: 'milestones',
          head: 'Milestones',
          body: (
            <ul className="doc-list">
              {entries.map((entry) => (
                <li key={entry.kind}>
                  {entry.kind} — {localDate(entry.occurredAt)}
                  {entry.acknowledgedAt ? ' (in history)' : ''}
                </li>
              ))}
            </ul>
          ),
        },
      ]}
    />
  );
}

/* Re-exported so the acceptance suite can assert the exact §20 sentence and the
   register without reaching into the shared package from a surface test. */
export { ACT_CAUGHT_UP, LIVE_ABSENCES };
