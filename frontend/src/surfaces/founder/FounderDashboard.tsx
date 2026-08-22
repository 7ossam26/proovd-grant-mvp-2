import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

const REFERENCE_STATE_PARAMS = ['phase', 'day', 'type', 'effort', 'upfront'] as const;

/**
 * Hosts the final founder dashboard reference without inheriting any of the
 * retired dashboard's layout, styles, or application chrome.
 */
export function FounderDashboard() {
  const [searchParams] = useSearchParams();

  const source = useMemo(() => {
    const dashboardParams = new URLSearchParams();

    for (const key of REFERENCE_STATE_PARAMS) {
      if (searchParams.has(key)) {
        dashboardParams.set(key, searchParams.get(key) ?? '');
      }
    }

    const query = dashboardParams.toString();
    return `/founder-dashboard-final.html${query ? `?${query}` : ''}`;
  }, [searchParams]);

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
