/**
 * Step 26 — your Backer rewards — Founder Flow v2, Session F.
 *
 * `campaign_reward_packages`, through `saveRewardPackage` — the same route
 * `/campaigns/:campaignId/build` calls. §14.4 requires at least one, which is
 * why `deriveBuildStatus` lists `rewardPackages` among what is missing until
 * there is one.
 *
 * The reference is a three-card pager. Each complete card is persisted through
 * the existing build API while its exact local editing and navigation states
 * remain controlled by this screen.
 *
 * ── The price is cents, and the browser does no arithmetic ─────────────────
 * `priceCents` crosses the wire as a decimal string of integer cents, and what
 * a Founder types in dollars is converted once, here, at the point of entry —
 * never re-derived from a formatted value.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useParams } from 'react-router';
import { BuildStepPage } from './BuildStepPage.js';
import { useBuildFlow } from './useBuild.js';
import {
  removeRewardPackage,
  saveRewardPackage,
  type RewardPackageView,
} from '../founder/api.js';
import { flowDirection, FlowPage, HelpDrawer, useFlowNav } from './FlowPage.js';
import {
  isReferenceWalkthrough,
  readReferenceDraft,
  writeReferenceDraft,
} from './referenceWalkthrough.js';

/** Dollars as typed → integer cents, once. `12.5` and `12.50` are the same. */
function toCents(typed: string): string | null {
  const match = /^\s*\$?\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(typed);
  if (!match) return null;
  const cents = `${match[2] ?? ''}00`.slice(0, 2);
  return `${BigInt(match[1]!) * 100n + BigInt(cents)}`;
}

export function RewardsStep() {
  const { campaignId = '' } = useParams();
  const build = useBuildFlow(campaignId);
  const seeded = useRef(false);
  const [cards, setCards] = useState<RewardDraft[]>([blankReward()]);
  const [index, setIndex] = useState(0);
  const [focus, setFocus] = useState<RewardField | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!build.state || seeded.current) return;
    seeded.current = true;
    const walkthroughCards = isReferenceWalkthrough(campaignId)
      ? readWalkthroughRewards(campaignId)
      : null;
    setCards(
      walkthroughCards ??
        (build.state.rewardPackages.length
          ? build.state.rewardPackages.map(fromPackage)
          : [blankReward()]),
    );
  }, [build.state, campaignId]);

  if (!build.state || build.failure) {
    return (
      <BuildStepPage
        pageId="rewards"
        campaignId={campaignId}
        build={build}
        title="Add your Backer Rewards"
        lede=""
      >
        {null}
      </BuildStepPage>
    );
  }

  return (
    <FlowPage pageId="rewards" param={campaignId}>
      <RewardsBody
        campaignId={campaignId}
        model={build.state.model}
        cards={cards}
        setCards={setCards}
        index={index}
        setIndex={setIndex}
        focus={focus}
        setFocus={setFocus}
        error={error}
        setError={setError}
        refresh={build.refresh}
      />
    </FlowPage>
  );
}

type RewardField = 'title' | 'date' | 'body' | 'price';

interface RewardDraft {
  id?: string;
  title: string;
  date: string;
  body: string;
  price: string;
  commitment: string;
}

function blankReward(): RewardDraft {
  return { title: '', date: '', body: '', price: '', commitment: '' };
}

function readWalkthroughRewards(campaignId: string): RewardDraft[] | null {
  const value = readReferenceDraft(campaignId, 'rewards');
  if (!Array.isArray(value) || value.length === 0) return null;
  const rewards = value.filter(
    (entry): entry is RewardDraft =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Partial<RewardDraft>).title === 'string' &&
      typeof (entry as Partial<RewardDraft>).date === 'string' &&
      typeof (entry as Partial<RewardDraft>).body === 'string' &&
      typeof (entry as Partial<RewardDraft>).price === 'string' &&
      typeof (entry as Partial<RewardDraft>).commitment === 'string' &&
      (typeof (entry as Partial<RewardDraft>).id === 'string' ||
        typeof (entry as Partial<RewardDraft>).id === 'undefined'),
  );
  return rewards.length === value.length ? rewards : null;
}

function fromPackage(reward: RewardPackageView): RewardDraft {
  const cents = BigInt(reward.priceCents);
  const dollars = cents / 100n;
  const remainder = cents % 100n;
  return {
    id: reward.id,
    title: reward.title,
    date: reward.delivery,
    body: reward.contents,
    price: remainder === 0n ? `$${dollars}` : `$${dollars}.${remainder.toString().padStart(2, '0')}`,
    commitment: reward.fulfillmentCommitment,
  };
}

function RewardsBody({
  campaignId,
  model,
  cards,
  setCards,
  index,
  setIndex,
  focus,
  setFocus,
  error,
  setError,
  refresh,
}: {
  campaignId: string;
  model: 'idea' | 'product';
  cards: RewardDraft[];
  setCards: Dispatch<SetStateAction<RewardDraft[]>>;
  index: number;
  setIndex: Dispatch<SetStateAction<number>>;
  focus: RewardField | null;
  setFocus: (field: RewardField | null) => void;
  error: string | null;
  setError: (error: string | null) => void;
  refresh: () => Promise<void>;
}) {
  const { leaveToPage, param } = useFlowNav();
  const [saving, setSaving] = useState(false);
  const walkthrough = isReferenceWalkthrough(campaignId);
  const card = cards[index] ?? blankReward();

  const patchCard = useCallback(
    (patch: Partial<RewardDraft>) =>
      setCards((current) => {
        const next = current.map((reward, rewardIndex) =>
          rewardIndex === index ? { ...reward, ...patch } : reward,
        );
        if (walkthrough) writeReferenceDraft(campaignId, 'rewards', next);
        return next;
      }),
    [campaignId, index, setCards, walkthrough],
  );

  const persist = useCallback(
    async (reward: RewardDraft, rewardIndex: number) => {
      const cents = toCents(reward.price);
      const hasInput = Boolean(
        reward.title.trim() || reward.body.trim() || reward.date.trim() || reward.price.trim(),
      );
      if (!hasInput) return true;
      if (!reward.title.trim() || !reward.body.trim() || !reward.date.trim() || cents === null) {
        setError('Add a title, description, delivery date, and valid price before leaving this reward.');
        return false;
      }
      setError(null);
      setSaving(true);
      try {
        const result = await saveRewardPackage(campaignId, {
          ...(reward.id && !reward.id.startsWith('walkthrough-reward-')
            ? { packageId: reward.id }
            : {}),
          sku: reward.title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 40),
          title: reward.title.trim(),
          priceCents: cents,
          contents: reward.body.trim(),
          fulfillmentCommitment: reward.commitment.trim() || reward.body.trim(),
          delivery: reward.date.trim(),
          sortOrder: rewardIndex,
        });
        setCards((current) =>
          current.map((entry, entryIndex) =>
            entryIndex === rewardIndex ? { ...entry, id: result.package.id } : entry,
          ),
        );
        await refresh();
        return true;
      } catch {
        setError('We could not save that reward. Nothing has changed.');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [campaignId, refresh, setCards, setError, walkthrough],
  );

  const addOrContinue = async () => {
    if (!(await persist(card, index))) return;
    if (cards.length >= 3) {
      leaveToPage('payouts');
      return;
    }
    setCards((current) => {
      const next = [...current, blankReward()];
      if (walkthrough) writeReferenceDraft(campaignId, 'rewards', next);
      return next;
    });
    setIndex(cards.length);
    setFocus(null);
  };

  const goBack = async () => {
    if (await persist(card, index)) leaveToPage('faqs', -1);
  };

  const moveTo = async (nextIndex: number) => {
    if (!(await persist(card, index))) return;
    setIndex(nextIndex);
    setFocus(null);
  };

  const removeCurrent = async () => {
    if (cards.length <= 1) return;
    setError(null);
    try {
      if (card.id && !card.id.startsWith('walkthrough-reward-')) {
        await removeRewardPackage(campaignId, card.id);
      }
      setCards((current) => {
        const next = current.filter((_, rewardIndex) => rewardIndex !== index);
        if (walkthrough) writeReferenceDraft(campaignId, 'rewards', next);
        return next;
      });
      setIndex(Math.max(0, index - 1));
      setFocus(null);
      if (card.id && !card.id.startsWith('walkthrough-reward-')) await refresh();
    } catch {
      setError('We could not delete that reward. Nothing has changed.');
    }
  };

  return (
    <section className="ff-reward-ref">
      <button
        type="button"
        className="ff-reward-ref__back"
        aria-label="Back to your FAQs"
        onClick={() => void goBack()}
        disabled={saving}
      >
        <Chevron direction="left" small /> Back
      </button>
      <header className="ff-reward-ref__top">
        <img src={REWARD_ASSETS.logo} alt="proovd" className="ff-reward-ref__logo" />
        <HelpDrawer
          pageId="rewards"
          param={param}
          trigger={<button className="ff-reward-ref__help" type="button">Help</button>}
        />
      </header>

      <RewardsStage>
        <div className="ff-reward-ref__lockup">
          <div data-reward-anim="head" className="ff-reward-ref__intro">
            <h1>Add your Backer Rewards</h1>
            <p>
              Backer Rewards are what supporters receive for backing your{' '}
              {model === 'product' ? 'Product' : 'Idea'}. Don’t rely only on just discounts, offer
              in app rewards so that you get more of the right users using your app.
            </p>
            <button type="button" className="ff-reward-ref__guide">
              Our guide on rewards
            </button>
          </div>

          <div className="ff-reward-ref__card-wrap">
            <div data-reward-anim="panel" className="ff-reward-ref__card">
              <img
                data-reward-flourish="1"
                src={REWARD_ASSETS.gift}
                alt=""
                className="ff-reward-ref__gift"
              />

              <div className="ff-reward-ref__title-row">
                <RewardLine className="ff-reward-ref__title-field">
                  <span className="ff-reward-ref__input-row">
                    <input
                      aria-label="Reward title"
                      value={card.title}
                      placeholder={`Reward ${index + 1}`}
                      onChange={(event) => patchCard({ title: event.currentTarget.value })}
                      onFocus={() => setFocus('title')}
                      onBlur={() => setFocus(null)}
                    />
                    {focus !== 'title' ? <Pencil /> : null}
                  </span>
                </RewardLine>

                <RewardLine className={`ff-reward-ref__date-field${card.date ? ' has-value' : ''}`}>
                  <span className="ff-reward-ref__delivered">Delivered by</span>
                  <span className="ff-reward-ref__date-row">
                    <input
                      aria-label="Delivered by"
                      value={card.date}
                      placeholder="MM/YY"
                      inputMode="numeric"
                      onChange={(event) => {
                        const digits = event.currentTarget.value.replace(/\D/g, '').slice(0, 4);
                        patchCard({ date: digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits });
                      }}
                      onFocus={() => setFocus('date')}
                      onBlur={() => setFocus(null)}
                    />
                    {focus !== 'date' ? <Pencil /> : null}
                  </span>
                </RewardLine>
              </div>

              <RewardLine className="ff-reward-ref__body-field">
                <span className="ff-reward-ref__body-row">
                  <textarea
                    aria-label="Reward description"
                    value={card.body}
                    placeholder={`Reward ${index + 1} description explaining exactly what the user gets when they preorder`}
                    onChange={(event) => patchCard({ body: event.currentTarget.value })}
                    onFocus={() => setFocus('body')}
                    onBlur={() => setFocus(null)}
                  />
                  {focus !== 'body' ? <Pencil /> : null}
                </span>
              </RewardLine>

              <div className="ff-reward-ref__price-row">
                <RewardLine className="ff-reward-ref__price-field">
                  <span className="ff-reward-ref__input-row">
                    <input
                      aria-label="Reward price"
                      value={card.price}
                      placeholder="$25"
                      inputMode="decimal"
                      onChange={(event) => patchCard({ price: event.currentTarget.value })}
                      onFocus={() => setFocus('price')}
                      onBlur={() => setFocus(null)}
                    />
                    {focus !== 'price' ? <Pencil large /> : null}
                  </span>
                </RewardLine>
                <span className="ff-reward-ref__pager">
                  <button
                    type="button"
                    aria-label="Previous reward"
                    disabled={saving || index === 0}
                    onClick={() => void moveTo(Math.max(0, index - 1))}
                  >
                    <Chevron direction="left" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next reward"
                    disabled={saving || index >= cards.length - 1}
                    onClick={() => void moveTo(Math.min(cards.length - 1, index + 1))}
                  >
                    <Chevron direction="right" />
                  </button>
                </span>
              </div>

              <button
                type="button"
                data-reward-anim="cta"
                className="ff-reward-ref__cta"
                onClick={() => void addOrContinue()}
                disabled={saving}
              >
                {index + 1}/3 Add Rewards
              </button>
              {error ? <p className="ff-reward-ref__error" role="alert">{error}</p> : null}
            </div>

            {cards.length > 1 ? (
              <button
                type="button"
                className="ff-reward-ref__delete"
                onClick={() => void removeCurrent()}
                disabled={saving}
              >
                Delete reward {index + 1}
              </button>
            ) : null}
          </div>
        </div>
      </RewardsStage>
    </section>
  );
}

const REWARD_ASSETS = {
  logo: '/assets/proovd-logo.svg',
  gift: '/assets/reward-gift.webp',
};

function RewardLine({ children, className }: { children: ReactNode; className: string }) {
  return <span className={`ff-reward-ref__line ${className}`}>{children}</span>;
}

function Pencil({ large = false }: { large?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={large ? 'ff-reward-ref__pencil is-large' : 'ff-reward-ref__pencil'}
      fill="none"
      stroke="#A2AFA8"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function Chevron({ direction, small = false }: { direction: 'left' | 'right'; small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={small ? 11 : 46}
      height={small ? 11 : 46}
      fill="none"
      stroke="currentColor"
      strokeWidth={small ? 2.5 : 2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === 'left' ? 'M15 5 8 12l7 7' : 'm9 5 7 7-7 7'} />
    </svg>
  );
}

function RewardsStage({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef(flowDirection());

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const scale = Math.min(window.innerWidth / 2496, window.innerHeight / 1542) * 0.78;
      stage.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(4)})`;
    };
    const settle = () => window.setTimeout(fit, 320);
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', settle);

    const gsap = (
      window as unknown as {
        gsap?: {
          set: (target: unknown, vars: Record<string, unknown>) => void;
          fromTo: (target: unknown, from: Record<string, unknown>, to: Record<string, unknown>) => void;
          killTweensOf: (target: unknown) => void;
        };
      }
    ).gsap;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animated = Array.from(stage.querySelectorAll('[data-reward-anim]'));
    const flourish = stage.querySelector('[data-reward-flourish]');
    if (gsap && !reduced) {
      gsap.fromTo(
        animated,
        { x: 150 * directionRef.current, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: 0.62,
          ease: 'power3.out',
          force3D: true,
          stagger: { each: 0.085, from: directionRef.current === -1 ? 'end' : 'start' },
          clearProps: 'transform,opacity',
        },
      );
      if (flourish) {
        gsap.fromTo(
          flourish,
          { scale: 0.9, opacity: 0, transformOrigin: '50% 50%' },
          {
            scale: 1,
            opacity: 1,
            duration: 0.8,
            ease: 'back.out(1.3)',
            delay: 0.24,
            force3D: true,
            clearProps: 'transform,opacity',
          },
        );
      }
    }
    const sweep = window.setTimeout(() => {
      if (gsap) gsap.set([...animated, ...(flourish ? [flourish] : [])], { clearProps: 'transform,opacity' });
    }, 2200);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', settle);
      window.clearTimeout(sweep);
      if (gsap) gsap.killTweensOf([...animated, ...(flourish ? [flourish] : [])]);
    };
  }, []);

  return <div className="ff-reward-ref__stage" ref={stageRef}>{children}</div>;
}
