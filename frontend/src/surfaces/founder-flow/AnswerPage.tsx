/**
 * The shell every §12 answer renders inside — Founder Flow v2, Session D.
 *
 * Screens 10–14 are one layout five times: a trail line naming the answer
 * before this one, the optional/US$2 tag, the question as the page's heading,
 * what makes it count, the controls, and a nav row. Five copies of that is four
 * chances for one of them to lose the §12 sentence or the autosave status.
 *
 * ── The "$2 discount" is the SETTING, never the number ──────────────────────
 * The reference hardcodes `FEE_PER=2`. §6 makes it `listing_fee_item_discount_cents`
 * and Phase 06's rule is that a hardcoded number is a bug even when it is
 * right. The tag renders `state.fee.itemDiscountCents`, which the server
 * computed from the setting, and renders NOTHING if there is no calculation to
 * read — an invented "$2" would be a commercial claim this browser made up.
 *
 * ── Where Next goes is in the ADDRESS ───────────────────────────────────────
 * The reference: "Jumping into a section from Last look returns you to Last
 * look on that section's Next instead of continuing forward." That is a router
 * contract rather than a component flag, so it is `?from=review` — which
 * survives a reload in the middle of an edit, and a component flag would not.
 * `Flow`'s own `persistKey` is the localStorage version of the same idea and is
 * deliberately not used here: this sequence's position is the URL.
 *
 * ── Nothing on this page marks an answer done ───────────────────────────────
 * §12's completion is derived server-side from objective evidence, on every
 * save. There is no control here that sets `complete`, no patch key that would
 * carry one, and `FLOW_COMPLETION_IS_DECIDED` says so where somebody would look
 * for the checkbox that is not there.
 */

import type { ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import {
  FLOW_COMPLETION_IS_DECIDED,
  EVIDENCE_REJECTIONS,
  OPTIONAL_ITEMS,
  formatUsd,
  founderAnswerLabel,
  founderAnswerNext,
  founderAnswerPrevious,
  founderFlowPage,
  type OptionalItemKey,
} from '@proovd/shared';
import { Button, StatePanel, Tag, NO_ACTION } from '../../components/index.js';
import { SurfaceLoading } from '../../features/public/states.js';
import { describeSaveState } from '../../lib/autosave.js';
import { HelperResources } from '../founder/HelperResources.js';
import { FlowPage, useFlowNav } from './FlowPage.js';
import { useSetupWorkspace, type SetupWorkspace } from './useSetup.js';
import type { ItemState, WorkspaceState } from '../founder/api.js';

/** The server sends codes; the register owns the sentences (§27.1). */
export function rejectionText(code: string): string {
  return (EVIDENCE_REJECTIONS as Record<string, string>)[code] ?? 'This is not complete yet.';
}

/**
 * What §12 decided about one answer, and why.
 *
 * A rejection is rendered as the reason it did not count rather than as a
 * failure: every one of these is a thing the Founder can still do, and the
 * §12 register writes them that way.
 */
export function ItemStatus({ item }: { item: ItemState | undefined }) {
  if (!item) return null;

  if (item.complete) {
    return (
      <p className="ff-item__status ff-item__status--done">
        <Tag variant="moss">Counts</Tag>{' '}
        {item.decisionSource === 'admin_override'
          ? 'Proovd recorded this as complete.'
          : 'This saving is on your listing fee.'}
      </p>
    );
  }

  return (
    <div className="ff-item__status">
      <Tag>Not counting yet</Tag>
      <ul className="ff-item__reasons">
        {item.rejections.map((code) => (
          <li key={code}>
            {code === 'invalidated' && item.invalidated.explanation
              ? item.invalidated.explanation
              : rejectionText(code)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * §12's static helper guidance, under a heading of its own.
 *
 * The guidance is an `Accordion`, which renders an `h3`. On the old workspace
 * that sat under a step's own `h2` and read correctly; on a page whose heading
 * is the question itself it would jump `h1` to `h3`, which §33.11.2 catches and
 * which a screen-reader user meets as a missing level. So the block names
 * itself, which it should have anyway — it is a section of the page.
 *
 * §12: "static, copy-ready guidance—not an embedded AI product". There is no
 * generate control inside it and no route that would produce one.
 */
export function HelperBlock({
  subject,
  title,
}: {
  subject: 'competition' | 'branding' | 'visuals' | 'story';
  title: string;
}) {
  return (
    <section className="ff-helper" aria-labelledby={`ff-helper-${subject}`}>
      <h2 id={`ff-helper-${subject}`} className="ff-helper__head">
        {title}
      </h2>
      <HelperResources subject={subject} />
    </section>
  );
}

interface AnswerPageProps {
  pageId: string;
  itemKey: OptionalItemKey;
  /** The controls. Rendered with the loaded workspace and its autosave. */
  children: (setup: SetupWorkspace & { state: WorkspaceState }) => ReactNode;
}

export function AnswerPage({ pageId, itemKey, children }: AnswerPageProps) {
  const { campaignId = '' } = useParams();
  const setup = useSetupWorkspace(campaignId);
  const page = founderFlowPage(pageId);

  if (setup.failure) {
    return (
      <FlowPage pageId={pageId} param={campaignId}>
        <div className="ff-answer">
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
    return <SurfaceLoading subject={page?.title ?? 'this step'} reference="Your campaign" />;
  }

  return (
    <FlowPage pageId={pageId} param={campaignId} badge>
      <Body pageId={pageId} itemKey={itemKey} setup={{ ...setup, state: setup.state }}>
        {children}
      </Body>
    </FlowPage>
  );
}

/** Split from the loader so `useFlowNav` — which only exists under `FlowPage` — is available. */
function Body({
  pageId,
  itemKey,
  setup,
  children,
}: {
  pageId: string;
  itemKey: OptionalItemKey;
  setup: SetupWorkspace & { state: WorkspaceState };
  children: AnswerPageProps['children'];
}) {
  const { leaveToPage } = useFlowNav();
  const [params] = useSearchParams();
  const fromReview = params.get('from') === 'review';

  const record = OPTIONAL_ITEMS.find((entry) => entry.key === itemKey)!;
  const item = setup.state.items.find((entry) => entry.item === itemKey);
  const previous = founderAnswerPrevious(pageId);
  const next = founderAnswerNext(pageId);
  const discount = setup.state.fee?.itemDiscountCents;

  /* Where Next goes: back to Last look when the edit was opened from there,
     otherwise on through the sequence — and Last look is the end of it. */
  const forwardId = fromReview ? 'last-look' : (next?.pageId ?? 'last-look');
  const forwardTitle = founderFlowPage(forwardId)?.title ?? 'the next step';
  const backId = previous?.pageId ?? 'last-look';
  const backTitle = founderFlowPage(backId)?.title ?? 'the previous step';

  return (
    <div className="ff-answer">
      {previous ? (
        <p className="ff-answer__trail" data-anim="note">
          {founderAnswerLabel(previous)}
        </p>
      ) : null}

      {/* §12 calls these optional and worth a discount each. Both halves are
          facts a Founder is entitled to before spending time on the step. */}
      <p className="ff-answer__optional" data-anim="note">
        <Tag variant="mint">Optional</Tag>{' '}
        {discount
          ? `Finishing this takes ${formatUsd(BigInt(discount))} off your listing fee.`
          : 'Finishing this lowers your listing fee.'}
      </p>

      <h1 className="ff-answer__head" data-anim="head">
        {record.question}
      </h1>
      {/* The §12 rule, LABELLED as a rule.

          `completesWhen` is written as a statement of the finished state —
          the interview entry is literally "Your booking is confirmed." — so
          as a bare lede under the question it reads as a claim that one IS
          confirmed, on the one screen where nothing is booked yet. §1.4. The
          label makes it the condition it always was, and the register is not
          rewritten for one screen's layout. */}
      <p className="ff-answer__lede" data-anim="sub">
        <span className="ff-answer__rule">What makes this count</span>
        {record.completesWhen}
      </p>

      <ItemStatus item={item} />

      <div className="ff-answer__field" data-anim="field">
        {children(setup)}
      </div>

      <p className="ff-answer__derived" data-anim="note">
        {FLOW_COMPLETION_IS_DECIDED}
      </p>

      <div className="ff-nav" data-anim="cta">
        {/* The first optional answer renders no Back control, and that is the
            fix for a real cycle rather than a missing affordance.

            Everything before this page is behind the draft token, which §10's
            claim invalidated, so there is no earlier address to return to —
            the reference's `back()` sends `vetting` vStep 3 to vStep 2
            (Positioning) and we cannot. It used to send `visuals` to Last look
            instead, which is five pages FORWARD, and that closed a ring:
            Back from Last look walked socials → story → interview → branding →
            visuals and then jumped forward to Last look again, so pressing
            Back never left the sequence. The first page of a stage offers no
            Back, exactly as `problem`, `solution` and `reach` do at the start
            of stage 1.

            An edit opened from Last look still returns there, because that
            contract is in the address (`?from=review`) rather than in the
            sequence — so it is unaffected by any of this. */}
        {fromReview || previous ? (
          <Button
            tier="tertiary"
            onClick={() => leaveToPage(fromReview ? 'last-look' : backId, -1)}
          >
            {fromReview ? 'Back to Last look' : `Back to ${backTitle}`}
          </Button>
        ) : null}
        <span
          className="ff-confirm__status"
          role="status"
          aria-live="polite"
          data-state={setup.autosave.state.status}
        >
          {describeSaveState(setup.autosave.state)}
        </span>
        <Button
          tier="primary"
          onClick={() => {
            void setup.autosave.flush().finally(() => leaveToPage(forwardId, 1));
          }}
        >
          {fromReview ? 'Back to Last look' : `Continue to ${forwardTitle}`}
        </Button>
      </div>
    </div>
  );
}
