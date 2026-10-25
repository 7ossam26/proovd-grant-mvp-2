import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { fetchSetupChangeRequests, type SetupChangeRequest } from './api.js';
import './setup-change-requests.css';

/** The saved request travels with its edit page; email delivery is not its only home. */
export function SetupChangeRequests({ campaignId, floating = false }: {
  campaignId: string;
  floating?: boolean;
}) {
  const location = useLocation();
  const selected = new URLSearchParams(location.search).get('changeRequest');
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; requests: SetupChangeRequest[] }
  >({ kind: 'loading' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    fetchSetupChangeRequests(campaignId).then(
      ({ requests }) => { if (active) setState({ kind: 'ready', requests }); },
      () => { if (active) setState({ kind: 'failed' }); },
    );
    return () => { active = false; };
  }, [campaignId, retry]);

  const className = `setup-change-notes${floating ? ' setup-change-notes--floating' : ''}`;
  if (state.kind === 'loading') {
    return selected ? <aside className={className} role="status">Loading the requested change…</aside> : null;
  }
  if (state.kind === 'failed') {
    return selected ? (
      <aside className={className} aria-label="Requested change">
        <p>We could not load the requested change.</p>
        <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
      </aside>
    ) : null;
  }

  const campaignPrefix = `/campaigns/${encodeURIComponent(campaignId)}/`;
  const requests = state.requests.filter((item) => {
    // The API supplies local edit destinations. Never turn an unexpected URL
    // into an outbound link while showing private campaign feedback.
    if (!item.deepLink.startsWith(campaignPrefix)) return false;
    return !floating || item.id === selected || item.deepLink.split('?')[0] === location.pathname;
  });
  if (!requests.length) {
    return selected ? <aside className={className}>This change request is no longer available. Contact Proovd if you need help.</aside> : null;
  }

  const ordered = [...requests].sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
  return (
    <aside className={className} aria-label="Requested changes from Proovd">
      <details key={selected ?? 'all'} open={Boolean(selected)}>
        <summary>Requested changes from Proovd <span>({requests.length})</span></summary>
        <div className="setup-change-notes__body">
          {ordered.map((item) => (
            <article key={item.id}>
              <strong>{item.fieldLabel}</strong>
              <p>{item.reason}</p>
              <Link to={item.deepLink}>Open this field</Link>
            </article>
          ))}
        </div>
      </details>
    </aside>
  );
}
