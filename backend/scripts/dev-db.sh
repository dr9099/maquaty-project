#!/usr/bin/env bash
# قاعدة بيانات التطوير المدمجة (PostgreSQL zonky داخل node_modules) — للتطوير فقط
# الإنتاج: سيرفر PostgreSQL حقيقي (20-deployment.md)
# ملاحظة: الحزمة تشحن initdb/pg_ctl/postgres فقط (بلا psql/createdb) — كل عمليات SQL عبر prisma db execute
set -e
cd "$(dirname "$0")/.."

PG_BIN="node_modules/@embedded-postgres/windows-x64/native/bin"
PGDATA=".pgdata"
PGPORT=5433

case "$1" in
  init)
    if [ -d "$PGDATA" ]; then
      echo "قاعدة البيانات مهيأة مسبقاً ($PGDATA)."
      exit 0
    fi
    echo "maqouti" > .pgpass_tmp
    "$PG_BIN/initdb.exe" -D "$PGDATA" -U maqouti --pwfile=.pgpass_tmp -E UTF8 --locale=C > /dev/null
    rm .pgpass_tmp
    echo "port = $PGPORT" >> "$PGDATA/postgresql.conf"
    echo "listen_addresses = '127.0.0.1'" >> "$PGDATA/postgresql.conf"
    echo "تمت التهيئة في $PGDATA على المنفذ $PGPORT (ابدأها بـ start ثم npx prisma migrate dev ينشئ قاعدة maqouti)"
    ;;
  start)
    "$PG_BIN/pg_ctl.exe" -D "$PGDATA" -l "$PGDATA/server.log" start
    echo "PostgreSQL يعمل على 127.0.0.1:$PGPORT"
    ;;
  stop)
    "$PG_BIN/pg_ctl.exe" -D "$PGDATA" stop || true
    ;;
  status)
    "$PG_BIN/pg_ctl.exe" -D "$PGDATA" status || true
    ;;
  *)
    echo "الاستخدام: $0 {init|start|stop|status}"
    exit 1
    ;;
esac
