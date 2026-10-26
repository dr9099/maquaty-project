#!/usr/bin/env bash
# تصفير بيانات الاختبار (يبقي البنية والإعدادات) — للتشغيل النظيف قبل e2e.sh
set -e
cd "$(dirname "$0")/.."
cat > scripts/reset.sql << 'EOF'
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public'
            AND tablename <> '_prisma_migrations' AND tablename <> 'system_settings') LOOP
    EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END $$;
EOF
npx prisma db execute --schema prisma/schema.prisma --file scripts/reset.sql
rm -f scripts/reset.sql
echo "✅ تم تصفير بيانات الاختبار (البنية والإعدادات بقيت)"
