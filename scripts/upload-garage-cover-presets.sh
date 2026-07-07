#!/usr/bin/env bash
# Upload garage cover preset assets to Cloudflare R2.
#
# Prereqs:
#   - PNG sources at docs/assets/garage-covers/<slug>@2x.png
#   - Converted JPEG+WebP at /tmp/garage-covers-export/<slug>@2x.{jpg,webp}
#     (run the conversion block in docs/assets/garage-covers/README.md first)
#   - aws CLI installed
#   - R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET env vars set
#
# Bucket layout target: garage-cover-presets/<slug>@2x.{jpg,webp}
# Cache-Control matches UPLOAD_CACHE_CONTROL in apps/api/src/services/uploads/types.ts.

set -euo pipefail

: "${R2_ACCOUNT_ID:?missing}"
: "${R2_ACCESS_KEY_ID:?missing}"
: "${R2_SECRET_ACCESS_KEY:?missing}"
: "${R2_BUCKET:?missing}"

SRC_DIR="${SRC_DIR:-/tmp/garage-covers-export}"
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
CACHE_CONTROL="public, max-age=31536000, immutable"

export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION="auto"

if [ ! -d "${SRC_DIR}" ]; then
  echo "Source dir not found: ${SRC_DIR}" >&2
  exit 1
fi

for f in "${SRC_DIR}"/*@2x.jpg; do
  [ -e "${f}" ] || { echo "No JPEG files in ${SRC_DIR}" >&2; exit 1; }
  base="$(basename "${f}")"
  aws s3 cp "${f}" "s3://${R2_BUCKET}/garage-cover-presets/${base}" \
    --endpoint-url "${ENDPOINT}" \
    --content-type "image/jpeg" \
    --cache-control "${CACHE_CONTROL}"
done

for f in "${SRC_DIR}"/*@2x.webp; do
  [ -e "${f}" ] || { echo "No WebP files in ${SRC_DIR}" >&2; exit 1; }
  base="$(basename "${f}")"
  aws s3 cp "${f}" "s3://${R2_BUCKET}/garage-cover-presets/${base}" \
    --endpoint-url "${ENDPOINT}" \
    --content-type "image/webp" \
    --cache-control "${CACHE_CONTROL}"
done

echo
echo "Uploaded. Verify:"
echo "  curl -I \"\${R2_PUBLIC_BASE_URL}/garage-cover-presets/default-door@2x.jpg\""
