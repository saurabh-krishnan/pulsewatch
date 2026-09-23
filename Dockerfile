# syntax=docker/dockerfile:1.7
#
# PulseWatch images (guide Phase 8). One file, several targets:
#
#   docker build --target api    .   API + the built web app on one origin
#   docker build --target worker .   the check worker
#   docker build --target demo   .   the fault-injection demo target
#   docker build --target web    .   the web app alone, on nginx (option B)
#   docker build                 .   "all": api + worker + demo in one container,
#                                    for a single free instance (see DEPLOY.md)
#
# Every target shares one build stage, so the web app and bundles are built
# once. The runtime stage holds only Prisma in node_modules: every other
# dependency is already inside the esbuild bundles.

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# deps: the full dependency tree, because building needs the dev tools too.
# Package manifests are copied first so this layer is cached until they change.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/demo-target/package.json apps/demo-target/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# build: the React app and one bundle per Node process.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN npx prisma generate --schema prisma/schema.prisma \
 && npm run build -w @pulsewatch/web \
 && node scripts/build-server.mjs

# ---------------------------------------------------------------------------
# runtime: what the bundles need at run time, and nothing else.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
# Prisma's generated client and native engine must live in node_modules, and
# the CLI applies migrations at start-up. Versions pinned to the lockfile's.
COPY deploy/runtime-package.json package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY prisma/schema.prisma prisma/schema.prisma
COPY prisma/migrations prisma/migrations
RUN npx prisma generate --schema prisma/schema.prisma
COPY --from=build /app/dist/server dist/server
COPY deploy/start.mjs deploy/start.mjs
# Nothing at run time needs root.
USER node

FROM runtime AS api
COPY --from=build /app/apps/web/dist web
ENV WEB_DIST_DIR=/app/web PROCESSES=api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.API_PORT||process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/start.mjs"]

FROM runtime AS worker
ENV PROCESSES=worker
CMD ["node", "deploy/start.mjs"]

FROM runtime AS demo
ENV PROCESSES=demo
EXPOSE 4100
CMD ["node", "deploy/start.mjs"]

# Option B: nginx serves the static app and proxies /api to the api container.
FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

# Last, so it is what a plain `docker build .` produces.
FROM runtime AS all
COPY --from=build /app/apps/web/dist web
ENV WEB_DIST_DIR=/app/web PROCESSES=api,worker,demo
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.API_PORT||process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/start.mjs"]
