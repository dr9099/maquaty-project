#!/usr/bin/env bash
# نشر إصدار جديد مع ترحيل قاعدة البيانات وفحص الصحة والتراجع التلقائي.
# يُستدعى من GitHub Actions أو يدوياً على الخادم بعد docker login.
set -euo pipefail

cd "$(dirname "$0")/../.."

: "${GHCR_OWNER:?GHCR_OWNER مطلوب}"
: "${IMAGE_TAG:?IMAGE_TAG مطلوب}"

COMPOSE="docker compose -f deploy/docker-compose.prod.yml"
API_DOMAIN="${API_DOMAIN:-api.maqouti.app}"
STATE_FILE="deploy/.current_tag"
PREVIOUS_TAG="$(cat "$STATE_FILE" 2>/dev/null || true)"

echo "==> نشر الإصدار: $IMAGE_TAG (السابق: ${PREVIOUS_TAG:-لا يوجد})"

$COMPOSE pull
$COMPOSE run --rm api npx prisma migrate deploy
$COMPOSE up -d --remove-orphans

echo "==> انتظار فحص الصحة: https://${API_DOMAIN}/v1/health"
healthy=0
for _ in $(seq 1 40); do
  if curl -fsS "https://${API_DOMAIN}/v1/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 3
done

if [ "$healthy" -ne 1 ]; then
  echo "!! فشل فحص الصحة. بدء التراجع..." >&2
  if [ -n "$PREVIOUS_TAG" ]; then
    export IMAGE_TAG="$PREVIOUS_TAG"
    $COMPOSE pull
    $COMPOSE up -d --remove-orphans
    echo "==> تم التراجع إلى: $PREVIOUS_TAG" >&2
  else
    echo "!! لا يوجد إصدار سابق معروف للتراجع إليه." >&2
  fi
  exit 1
fi

echo "$IMAGE_TAG" > "$STATE_FILE"
echo "==> اكتمل النشر بنجاح: $IMAGE_TAG"
