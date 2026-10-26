// scripts/db-reset.js
// تصفير بيانات الاختبار عبر Prisma مباشرة — متوافق مع كافة البيئات
const { PrismaClient } = require('@prisma/client');

async function reset() {
  const prisma = new PrismaClient();
  try {
    const tables = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables WHERE schemaname='public'
      AND tablename <> '_prisma_migrations' AND tablename <> 'system_settings'
    `;
    for (const { tablename } of tables) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
    }
    console.log('✅ تم تصفير بيانات الاختبار بنجاح عبر Prisma.');
  } finally {
    await prisma.$disconnect();
  }
}

reset().catch((e) => {
  console.error('❌ خطأ أثناء تصفير قاعدة البيانات:', e);
  process.exit(1);
});
