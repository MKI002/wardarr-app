# syntax=docker/dockerfile:1.7
# Wardarr container image. Multi-stage: build with the full toolchain, run
# with production dependencies only, as an unprivileged user.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
# Native modules may need to compile when no prebuilt binary fits.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/adapters/package.json packages/adapters/
COPY packages/i18n/package.json packages/i18n/
RUN pnpm install --frozen-lockfile --ignore-scripts=false
COPY . .
RUN pnpm --filter @wardarr/web build \
 && pnpm --filter @wardarr/server build \
 && pnpm --filter @wardarr/server deploy --prod --legacy /out \
 && test -f /out/dist/main.js \
 && cp -r apps/web/dist /out/web \
 && find /out -name '*.map' -delete

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    WARDARR_DATA_DIR=/data \
    WARDARR_WEB_DIR=/app/web \
    WARDARR_HOST=0.0.0.0 \
    WARDARR_PORT=8484
WORKDIR /app
COPY --from=build --chown=0:0 /out /app
RUN mkdir -p /data && chown 1000:1000 /data
USER 1000:1000
VOLUME ["/data"]
EXPOSE 8484
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.WARDARR_PORT||8484)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]

LABEL org.opencontainers.image.title="Wardarr" \
      org.opencontainers.image.description="Self-hosted control center for the *arr stack" \
      org.opencontainers.image.licenses="MIT"
