ARG APP_VERSION=development
ARG STRICT_DATABASE=1
ARG TEST_DATA_ADMIN=0
ARG DEPLOYMENT_ENV=production

FROM node:26-bookworm-slim AS dependencies
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci

FROM node:26-bookworm-slim AS builder
ARG APP_VERSION
ARG STRICT_DATABASE
ARG TEST_DATA_ADMIN
ARG DEPLOYMENT_ENV
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION \
    NEXT_PUBLIC_STRICT_DATABASE=$STRICT_DATABASE \
    NEXT_PUBLIC_TEST_DATA_ADMIN=$TEST_DATA_ADMIN \
    NEXT_PUBLIC_DEPLOYMENT_ENV=$DEPLOYMENT_ENV
WORKDIR /app
COPY --from=dependencies /app/web/node_modules ./web/node_modules
COPY docs/openapi.yaml ./docs/openapi.yaml
COPY web ./web
RUN npm --prefix web run build

FROM node:26-bookworm-slim AS runner
ARG APP_VERSION
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    HOSTNAME=0.0.0.0 \
    PORT=5181 \
    ARCHERO_PYTHON=/opt/archero-venv/bin/python \
    PYTHONPATH=/app

LABEL org.opencontainers.image.title="Archero Guild Web/API" \
      org.opencontainers.image.version=$APP_VERSION

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      python3 \
      python3-venv \
    && python3 -m venv /opt/archero-venv \
    && /opt/archero-venv/bin/pip install --no-cache-dir "psycopg[binary]" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY ocr/app/archero_guild ./archero_guild
COPY --from=builder /app/web/.next/standalone ./web
COPY --from=builder /app/web/.next/server ./web/.next/server
COPY --from=builder /app/web/.next/static ./web/.next/static
COPY --from=builder /app/web/public ./web/public
COPY --from=builder /app/web/sample-data.js ./web/sample-data.js

RUN mkdir -p /app/data \
    && chown -R node:node /app

USER node
EXPOSE 5181
WORKDIR /app/web
CMD ["node", "server.js"]
