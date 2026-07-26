ARG APP_VERSION=development

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
ARG APP_VERSION
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
WORKDIR /app
COPY --from=dependencies /app/web/node_modules ./web/node_modules
COPY web ./web
RUN npm --prefix web run build

FROM node:22-bookworm-slim AS runner
ARG APP_VERSION
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    HOSTNAME=0.0.0.0 \
    PORT=5181 \
    ARCHERO_PYTHON=/opt/archero-venv/bin/python \
    PYTHONPATH=/app

LABEL org.opencontainers.image.title="Archero Guild Observer" \
      org.opencontainers.image.version=$APP_VERSION

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      android-tools-adb \
      ca-certificates \
      python3 \
      python3-venv \
      tesseract-ocr \
      tesseract-ocr-eng \
    && python3 -m venv /opt/archero-venv \
    && /opt/archero-venv/bin/pip install --no-cache-dir pillow "psycopg[binary]" pytesseract \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY observer ./observer
COPY config ./config
COPY --from=builder /app/web/.next/standalone ./web
COPY --from=builder /app/web/.next/static ./web/.next/static
COPY --from=builder /app/web/public ./web/public
COPY --from=builder /app/web/sample-data.js ./web/sample-data.js

RUN mkdir -p /app/data/import-jobs /app/data/exports /app/screenshots/raw /app/screenshots/trash \
    && chown -R node:node /app

USER node
EXPOSE 5181
WORKDIR /app/web
CMD ["node", "server.js"]
