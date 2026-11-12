import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { securityHeadersMiddleware } from './common/security-headers.middleware';

// 1. تحويل BigInt (لـ lastSyncVersion و sizeBytes) إلى Number تلقائياً عند التسلسل لـ JSON
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

// 2. تحويل Prisma Decimal (لجميع الأسعار والكميات) إلى Number تلقائياً عند التسلسل لـ JSON (R-38 / توافق Flutter num)
(Prisma.Decimal.prototype as any).toJSON = function () {
  return this.toNumber();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('v1');
  app.use(securityHeadersMiddleware);

  // خلف Cloudflare / Caddy: نثق بقفزتين في الإنتاج للحصول على IP الحقيقي (Cloudflare + Caddy)
  const isProduction = process.env.NODE_ENV === 'production';
  const trustProxyRaw = process.env.TRUST_PROXY;
  const trustProxy =
    trustProxyRaw === undefined
      ? isProduction
        ? 2
        : 0
      : trustProxyRaw === 'true'
        ? 2
        : trustProxyRaw === 'false'
          ? false
          : Number(trustProxyRaw);
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);

  // إذا كان البروكسي مفعلاً، نعطي الأولوية لهيدر Cloudflare الموثوق cf-connecting-ip (أو x-real-ip)
  if (trustProxy) {
    app.use((req: any, _res: any, next: () => void) => {
      const rawCfIp = req.headers['cf-connecting-ip'];
      const rawRealIp = req.headers['x-real-ip'];
      const cfIp = Array.isArray(rawCfIp) ? rawCfIp[0] : rawCfIp;
      const realIp = Array.isArray(rawRealIp) ? rawRealIp[0] : rawRealIp;
      const clientIp =
        (typeof cfIp === 'string' && cfIp.trim()) ||
        (typeof realIp === 'string' && realIp.trim());
      if (clientIp) {
        req.headers['x-forwarded-for'] = clientIp.trim();
      }
      next();
    });
  }

  // زيادة سعة جسم الطلب لمعالجة دفعات المزامنة دون اتصال الكبيرة دون 413 Payload Too Large
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));

  // CORS مقيّد بنطاقات لوحة الأدمن (مطلوب في الإنتاج)
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : !isProduction,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'Origin',
      'X-Requested-With',
      'X-Request-Id',
      'Idempotency-Key',
      'X-MFA-Code',
      'X-Device-Fingerprint',
      'X-Step-Up-Code',
    ],
    maxAge: 86400,
  });

  // تحويل المفاتيح من snake_case إلى camelCase في مسارات الأدمن (/v1/admin/*) قبل الوصول إلى ValidationPipe (R-48)
  app.use(['/v1/admin', '/admin'], (req: any, _res: any, next: any) => {
    const toCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
    const normalize = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) normalize(item);
        return;
      }
      for (const key of Object.keys(obj)) {
        if (key === 'value') continue; // الحفاظ على كائنات قيم الإعدادات دون تعديل بنيتها
        const val = obj[key];
        normalize(val);
        const camelKey = toCamel(key);
        if (camelKey !== key) {
          if (obj[camelKey] === undefined) obj[camelKey] = val;
          delete obj[key]; // حذف المفتاح الـ snake_case حتى لا يرفضه forbidNonWhitelisted
        }
      }
    };
    normalize(req.body);
    normalize(req.query);
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  // شكل الخطأ الموحّد عبر APP_FILTER في AppModule (ApiExceptionFilter)

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`مَقوتي Backend يعمل على المنفذ ${port}`);
}

void bootstrap();
