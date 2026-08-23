import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { founderChapterForStatus } from '@proovd/shared';
import { SurfaceLoading } from '../../features/public/states.js';
import {
  fetchFounderDashboard,
  type FounderDashboardView,
} from './api.js';
import { FounderEntryCelebration } from '../founder-flow/LiveReferenceStep.js';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; dashboard: FounderDashboardView };

function referencePhase(dashboard: FounderDashboardView): string {
  const chapter = founderChapterForStatus(dashboard.status);
  if (chapter === 'live') return 'live';
  if (chapter === 'payouts' || chapter === 'after') return 'ended';
  return dashboard.status === 'creator_prep' || dashboard.status === 'creator_replacement'
    ? 'waiting'
    : 'matching';
}

function campaignDay(liveAt: string | null): number {
  if (!liveAt) return 1;
  return Math.max(1, Math.floor((Date.now() - new Date(liveAt).getTime()) / 86_400_000) + 1);
}

/** Hosts the final dashboard with facts read from the signed-in Founder's campaign. */
export function FounderDashboard() {
  const { campaignId = '' } = useParams<{ campaignId: string }>();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [entryComplete, setEntryComplete] = useState(
    () => searchParams.get('entry') === 'complete',
  );

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    fetchFounderDashboard(campaignId)
      .then(({ dashboard }) => {
        if (live) setState({ status: 'ready', dashboard });
      })
      .catch(() => {
        if (live) setState({ status: 'error' });
      });
    return () => {
      live = false;
    };
  }, [campaignId]);

  const source = useMemo(() => {
    if (state.status !== 'ready') return '';
    const { dashboard } = state;
    const dashboardParams = new URLSearchParams({
      campaign: dashboard.campaignId,
      type: dashboard.type === 'pre_launch' ? 'product' : 'idea',
      effort: dashboard.highEffort ? 'high' : 'standard',
      phase: referencePhase(dashboard),
      day: String(campaignDay(dashboard.campaignLiveAt)),
    });
    if (dashboard.title) dashboardParams.set('name', dashboard.title);
    if (dashboard.founderName) dashboardParams.set('founder', dashboard.founderName);
    if (dashboard.founderEmail) dashboardParams.set('email', dashboard.founderEmail);
    return `/founder-dashboard-final.html?${dashboardParams.toString()}`;
  }, [state]);

  if (state.status === 'loading') {
    return <SurfaceLoading subject="your dashboard" reference={campaignId} />;
  }

  if (state.status === 'error') {
    return (
      <main className="surface-state" aria-labelledby="founder-dashboard-error">
        <h1 id="founder-dashboard-error">Your dashboard could not be opened</h1>
        <p>Reload this page. Nothing about your campaign was changed.</p>
      </main>
    );
  }

  if (!entryComplete) {
    return <FounderEntryCelebration onContinue={() => setEntryComplete(true)} />;
  }

  return (
    <main
      aria-label="Founder dashboard"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#013f17',
      }}
    >
      <iframe
        src={source}
        title="Founder dashboard"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          border: 0,
          background: '#013f17',
        }}
      >
        <p>
          The founder dashboard could not be displayed.{' '}
          <a href={source}>Open the founder dashboard directly.</a>
        </p>
      </iframe>
    </main>
  );
}
