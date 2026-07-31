import { createBrowserRouter } from 'react-router';
import { lazy, Suspense, type ReactNode } from 'react';
import { MotionProvider } from './motion/MotionProvider.js';

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
