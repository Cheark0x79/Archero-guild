ARG APP_VERSION=development

FROM python:3.14-slim

ARG APP_VERSION

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    ARCHERO_AGENT_VERSION=$APP_VERSION

LABEL org.opencontainers.image.title="Archero Guild OCR" \
      org.opencontainers.image.version=$APP_VERSION

COPY ocr/requirements.txt /tmp/requirements.txt

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      tesseract-ocr \
      tesseract-ocr-chi-sim \
      tesseract-ocr-chi-tra \
      tesseract-ocr-eng \
      tesseract-ocr-rus \
    && pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 archero \
    && useradd --uid 10001 --gid archero --create-home --shell /usr/sbin/nologin archero

WORKDIR /app
COPY ocr/app/archero_guild ./archero_guild
COPY docs/contracts ./docs/contracts
COPY ocr/ui ./ocr/ui
COPY web/sample-data.js ./web/sample-data.js

USER archero
ENTRYPOINT ["python", "-m", "archero_guild.ocr.local_app"]
