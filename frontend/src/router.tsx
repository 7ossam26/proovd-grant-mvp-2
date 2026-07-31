import { createBrowserRouter } from 'react-router';
import { appRoutes } from './routes.js';

// The route table lives in `routes.tsx` so the acceptance suite can mount the
// same objects in a memory router (Spec §33.11.6 tests every public route for
// broken links; walking a hand-written copy would prove nothing).
export const router = createBrowserRouter(appRoutes);
