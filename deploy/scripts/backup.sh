#!/usr/bin/env bash
# نسخة احتياطية يومية مشفَّرة من PostgreSQL إلى R2/B2 مع احتفاظ محدود.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL مطلوب}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE مطلوب}"
: "${RCLONE_REMOTE:?RCLONE_REMOTE مطلوب (مثال: r2:maquaty-backups)}"

RETENTION="${BACKUP_RETENTION:-30d}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

DUMP="$WORK/maquaty-$STAMP.dump.gz"
ENC="$DUMP.gpg"

echo "==> pg_dump: $STAMP"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges | gzip -9 > "$DUMP"

echo "==> تشفير النسخة (AES256)"
gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
  --passphrase "$BACKUP_PASSPHRASE" \
  -o "$ENC" "$DUMP"

echo "==> رفع إلى: $RCLONE_REMOTE"
rclone copy "$ENC" "$RCLONE_REMOTE"

echo "==> حذف النسخ الأقدم من: $RETENTION"
rclone delete "$RCLONE_REMOTE" --min-age "$RETENTION"

echo "==> تمت النسخة الاحتياطية: $(basename "$ENC")"
