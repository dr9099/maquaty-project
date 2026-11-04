#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import crypto from 'node:crypto';

// CLI Script لاسترجاع حساب مالك المنصة (Platform Admin) مباشرة من السيرفر عبر SSH
// الاستخدام:
// npm run admin:reset-password -- --phone 770000000 [--password MyNewPass123] [--reset-mfa]

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    phone: '',
    password: '',
    resetMfa: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--phone' && i + 1 < args.length) {
      result.phone = args[++i].trim();
    } else if (arg === '--password' && i + 1 < args.length) {
      result.password = args[++i].trim();
    } else if (arg === '--reset-mfa') {
      result.resetMfa = true;
    }
  }

  return result;
}

async function main() {
  const { phone, password, resetMfa } = parseArgs();

  if (!phone) {
    console.error('❌ خطأ: يجب تحديد رقم هاتف الأدمن عبر --phone <رقم>');
    console.error('مثال: npm run admin:reset-password -- --phone 770000000 --reset-mfa');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const admin = await prisma.platformAdmin.findUnique({
      where: { phone },
    });

    if (!admin) {
      console.error(`❌ لم يتم العثور على حساب Platform Admin بالرقم: ${phone}`);
      process.exit(1);
    }

    const newPassword = password || crypto.randomBytes(6).toString('base64url').slice(0, 10) + 'A1!';
    const passwordHash = await hash(newPassword);

    const updateData = {
      passwordHash,
      failedMfaAttempts: 0,
      mfaLockedUntil: null,
    };

    if (resetMfa) {
      updateData.mfaSecret = null;
      updateData.mfaEnabled = false;
    }

    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: updateData,
    });

    console.log('══════════════════════════════════════════════════════');
    console.log('✅ تم إعادة تعيين بيانات Platform Admin بنجاح:');
    console.log(`   الاسم: ${admin.fullName}`);
    console.log(`   الهاتف: ${admin.phone}`);
    console.log(`   كلمة المرور الجديدة: ${newPassword}`);
    if (resetMfa) {
      console.log('   حالة الـ MFA: تم تصفيرها بنجاح (سيطلب التطبيق مسح QR جديد عند أول دخول).');
    }
    console.log('══════════════════════════════════════════════════════');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ خطأ غير متوقع:', err);
  process.exit(1);
});
