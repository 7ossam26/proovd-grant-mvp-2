import { createBrowserRouter } from 'react-router';
import { MotionProvider } from './motion/MotionProvider.js';

// Phase 1: single blank route. Each later phase adds routes here.
// React Router v7 data mode — loaders/actions added per phase.

function AppShell({ children }: { children: React.ReactNode }) {
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
      {/* Phase 02 adds the design system. Phase 05 builds the public site. */}
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <AppShell>
        <BlankPage />
      </AppShell>
    ),
  },
]);
