#!/usr/bin/env bash
# Exercise shipped image entrypoints, without host ports, credentials or volumes.
set -euo pipefail
web_image="${1:?Web image required}"
ocr_image="${2:?OCR image required}"
web_id=""
ocr_id=""
cleanup() {
  for container in "$web_id" "$ocr_id"; do
    if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null; fi
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
limits=(--network none --cpus 1 --memory 512m --pids-limit 128
  --security-opt no-new-privileges:true --cap-drop ALL)

# Confirm the actual binary and language packs, not only pytesseract imports.
docker run --rm "${limits[@]}" --entrypoint python "$ocr_image" -c '
import subprocess
from PIL import Image, ImageDraw, ImageFont
import pytesseract
languages = set(pytesseract.get_languages())
assert {"eng", "rus", "chi_sim", "chi_tra"} <= languages, languages
image = Image.new("RGB", (500, 100), "white")
ImageDraw.Draw(image).text((20, 15), "12345", fill="black", font=ImageFont.load_default(size=60))
result = pytesseract.image_to_string(image, config="--psm 7 -c tessedit_char_whitelist=0123456789").strip()
assert result == "12345", repr(result)
print("Real Tesseract OCR and installed language packs passed")
'

web_id=$(docker run -d "${limits[@]}" "$web_image")
ocr_id=$(docker run -d "${limits[@]}" --tmpfs /tmp:rw,size=32m \
  -e ARCHERO_SCREENSHOTS_ROOT=/tmp/captures -e ARCHERO_OUTBOX_ROOT=/tmp/outbox \
  -e ARCHERO_OCR_TARGETS_FILE=/tmp/targets.json \
  --entrypoint sh "$ocr_image" -c \
  'printf '\''{"local":{"mode":"local"}}'\'' > /tmp/targets.json; exec python -m archero_guild.ocr.local_app')

for attempt in $(seq 1 30); do
  if docker exec "$web_id" node -e \
      'fetch("http://127.0.0.1:5181/api/health").then(async r=>{if(!r.ok || !(await r.json()).ok)process.exit(1)}).catch(()=>process.exit(1))' \
      && docker exec "$ocr_id" python -c \
      'import urllib.request; urllib.request.urlopen("http://127.0.0.1:5190/api/status", timeout=2)'; then
    echo "Web/API and OCR image health checks passed"
    exit 0
  fi
  sleep 2
done
echo "Image health checks failed" >&2
docker logs "$web_id"
docker logs "$ocr_id"
exit 1
