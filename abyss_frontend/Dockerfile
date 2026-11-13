# syntax=docker/dockerfile:1
# Abyss frontend: Next.js 16, standalone output. deps -> builder -> runner.

# Node 24 LTS on Debian slim (Next 16 needs Node >= 20.9).
FROM node:24-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ============================================================================
# Stage 1: deps (node_modules exactly as package-lock.json says)
# ============================================================================
FROM base AS deps
# Manifests + patches first (npm ci's postinstall runs patch-package), so this
# slow layer is cached until they change.
COPY package.json package-lock.json ./
COPY patches ./patches
RUN --mount=type=cache,target=/root/.npm npm ci

# ============================================================================
# Stage 2: builder (`next build`)
# ============================================================================
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Browser-visible values, baked into the JS bundle at build time (not secrets).
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID

RUN npm run build

# ============================================================================
# Stage 3: runner
# ============================================================================
FROM base AS runner
# The standalone server.js reads PORT/HOSTNAME; 0.0.0.0 = reachable from outside.
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Debian security updates; remove npm/npx/corepack (the server runs with plain
# node, and npm bundles its own packages that image scanners flag).
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Standalone server + traced node_modules, plus static chunks and public
# assets (not included by standalone itself). Owned by the non-root "node" user.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000

# Healthy = the server answers a page request (redirects followed).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/home').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# node is PID 1 and receives Docker's stop signal directly.
CMD ["node", "server.js"]
