FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      tesseract-ocr \
      tesseract-ocr-chi-sim \
      tesseract-ocr-chi-tra \
      tesseract-ocr-eng \
      tesseract-ocr-rus \
    && pip install --no-cache-dir pillow pytesseract \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY ocr/app/archero_guild ./archero_guild
COPY docs/contracts ./docs/contracts
COPY ocr/ui ./ocr/ui
COPY web/sample-data.js ./web/sample-data.js

ENTRYPOINT ["python", "-m", "archero_guild.ocr.local_app"]
