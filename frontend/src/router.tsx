import { createBrowserRouter } from 'react-router';
import { lazy, Suspense, type ReactNode } from 'react';
import { MotionProvider } from './motion/MotionProvider.js';
import { LinkUnavailable } from './surfaces/LinkUnavailable.js';

// Phase 02: the design system plus a development-only gallery route. Product
// surfaces begin in Phase 05. Each later phase adds routes here.
// React Router v7 data mode — loaders/actions added per phase.

function AppShell({ children }: { children: ReactNode }) {
  return <MotionProvider>{children}</MotionProvider>;
}

function BlankPage() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
      }}
    >
      {import.meta.env.DEV ? (
        <a href="/_gallery" className="btn btn--secondary">
          <span className="btn__label">Open the design-system gallery</span>
        </a>
      ) : null}
    </div>
  );
}

// The gallery is a dev-only surface (Phase 02 §8). The dynamic import lives in a
// branch that Vite eliminates in the production build, so its code never ships.
const Gallery = import.meta.env.DEV
  ? lazy(() => import('./gallery/Gallery.js'))
  : null;

const routes = [
  {
    path: '/',
    element: (
      <AppShell>
        <BlankPage />
      </AppShell>
    ),
  },
  {
    // Phase 04 (§5.5). One route for every token failure — invalid, expired,
    // revoked, claimed, malformed, rate-limited, never-existed. Deliberately
    // takes no parameter and reads no state: anything this page could vary on
    // is something a caller could measure to learn whether a link, an account,
    // or a draft exists.
    path: '/link-unavailable',
    element: (
      <AppShell>
        <LinkUnavailable />
      </AppShell>
    ),
  },
];

if (Gallery) {
  routes.push({
    path: '/_gallery',
    element: (
      <AppShell>
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      </AppShell>
    ),
  });
}

export const router = createBrowserRouter(routes);
