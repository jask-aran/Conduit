FROM node:24.14.0-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c AS dependency-build-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/*

FROM dependency-build-base AS development-dependencies

WORKDIR /build/conduit-web
COPY conduit-web/package.json conduit-web/package-lock.json ./
RUN npm ci

FROM development-dependencies AS client-build

COPY conduit-web/index.html conduit-web/vite.config.js conduit-web/tsconfig.json ./
COPY conduit-web/public ./public
COPY conduit-web/scripts ./scripts
COPY conduit-web/src ./src
RUN npm run build

FROM dependency-build-base AS production-dependencies

WORKDIR /build/conduit-web
COPY conduit-web/package.json conduit-web/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24.14.0-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c AS runtime

ARG CONDUIT_RELEASE=development
LABEL org.opencontainers.image.title="Conduit" \
      org.opencontainers.image.description="Self-hosted personal agent interface" \
      org.opencontainers.image.revision="${CONDUIT_RELEASE}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git libgomp1 openssh-client tar \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node templates ./templates
COPY --chown=node:node conduit-web/package.json ./conduit-web/package.json
COPY --chown=node:node conduit-web/src ./conduit-web/src
COPY --from=production-dependencies --chown=node:node /build/conduit-web/node_modules ./conduit-web/node_modules
COPY --from=client-build --chown=node:node /build/conduit-web/dist ./conduit-web/dist

RUN mkdir -p /data/home /workspaces && chown -R node:node /data /workspaces

ENV NODE_ENV=production \
    HOME=/data/home \
    CONDUIT_HOST=0.0.0.0 \
    CONDUIT_PORT=4310 \
    CONDUIT_DATA_ROOT=/data \
    CONDUIT_CLIENT_DIST=/app/conduit-web/dist \
    CONDUIT_TEMPLATES_ROOT=/app/templates \
    CONDUIT_WORKSPACE_ALLOWLIST=/workspaces \
    CONDUIT_WORKSPACE_DEFAULT_ROOT=/workspaces \
    CONDUIT_WORKSPACE_SUGGESTION_ROOT=/workspaces \
    CONDUIT_RELEASE=${CONDUIT_RELEASE}

USER node
EXPOSE 4310
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4310/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["sh", "-c", "mkdir -p \"$HOME\" && exec node conduit-web/src/server.js"]
