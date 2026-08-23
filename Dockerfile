# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:20-alpine AS fe-build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
RUN npm ci --workspace=@proovd/frontend --workspace=@proovd/shared

COPY shared/ ./shared/
COPY frontend/ ./frontend/

# The remaining SVGs are imported through `new URL(..., import.meta.url)`.
# Runtime picture assets live canonically in `frontend/public/assets`.
COPY docs/design-refrence/Proovd-Founder-Flow-v2/assets/stripe.svg \
     docs/design-refrence/Proovd-Founder-Flow-v2/assets/kyc-id.svg \
     docs/design-refrence/Proovd-Founder-Flow-v2/assets/kyc-bank.svg \
     docs/design-refrence/Proovd-Founder-Flow-v2/assets/kyc-ssn.svg \
     ./docs/design-refrence/Proovd-Founder-Flow-v2/assets/

# Every workspace tsconfig extends this. Without it tsc reports TS5083 and then
# silently falls back to compiler defaults (target ES3, no skipLibCheck), which
# surfaces as ~120 bogus errors about BigInt literals and downlevelIteration.
COPY tsconfig.base.json ./

# Temporary pitch build: the walkthrough collects no card details and calls no
# payment provider. Its Pay action records a simulated paid campaign state so
# the Founder flow and Admin workflow read the same persisted fact.
ARG VITE_PITCH_DEMO=true
ENV VITE_PITCH_DEMO=$VITE_PITCH_DEMO

RUN npm run build --workspace=@proovd/frontend

# ── Stage 2: Build backend ────────────────────────────────────────────────────
FROM node:20-alpine AS be-build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
RUN npm ci --workspace=@proovd/backend --workspace=@proovd/shared

COPY shared/ ./shared/
COPY backend/ ./backend/
COPY tsconfig.base.json ./

RUN npm run build --workspace=@proovd/backend

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV SIMULATED_LISTING_PAYMENTS=true

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

RUN npm ci --workspace=@proovd/backend --workspace=@proovd/shared --omit=dev

# Compiled backend
COPY --from=be-build /app/backend/dist ./backend/dist

# Migrations are SQL — not compiled by tsc, must be copied separately
COPY --from=be-build /app/backend/src/db/migrations ./backend/dist/db/migrations

# Frontend build lands in backend/public to be served as static fallback
COPY --from=fe-build /app/frontend/dist ./backend/public

EXPOSE 3000

CMD ["node", "backend/dist/index.js"]
