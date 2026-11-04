#!/usr/bin/env bash
# استعادة نسخة احتياطية مشفَّرة إلى قاعدة بيانات (يتطلب تأكيداً صريحاً).
# الاستخدام: DATABASE_URL=... BACKUP_PASSPHRASE=... ./deploy/scripts/restore.sh <file.dump.gz.gpg>
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL مطلوب}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE مطلوب}"
FILE="${1:?مسار النسخة المشفَّرة مطلوب}"

if [ ! -f "$FILE" ]; then
  echo "الملف غير موجود: $FILE" >&2
  exit 1
fi

echo "!! سيتم استبدال محتوى قاعدة البيانات الحالية."
echo "!! اكتب RESTORE للتأكيد:"
read -r CONFIRM
if [ "$CONFIRM" != "RESTORE" ]; then
  echo "أُلغيت الاستعادة." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

DUMP_GZ="$WORK/restore.dump.gz"
DUMP="$WORK/restore.dump"

gpg --batch --yes --pinentry-mode loopback --decrypt --passphrase "$BACKUP_PASSPHRASE" -o "$DUMP_GZ" "$FILE"
gunzip -c "$DUMP_GZ" > "$DUMP"

pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "$DATABASE_URL" "$DUMP"

echo "==> اكتملت الاستعادة من: $(basename "$FILE")"
