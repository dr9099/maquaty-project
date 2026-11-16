import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { json, urlencoded } from 'express';
import { AppModule } from '../src/app.module';
import { securityHeadersMiddleware } from '../src/common/security-headers.middleware';

// 1. تحويل BigInt (لـ lastSyncVersion و sizeBytes) إلى Number تلقائياً عند التسلسل لـ JSON
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

// 2. تحويل Prisma Decimal (لجميع الأسعار والكميات) إلى Number تلقائياً عند التسلسل لـ JSON (R-38 / توافق Flutter num)
(Prisma.Decimal.prototype as any).toJSON = function () {
  return this.toNumber();
};

let cachedHandler: any = null;
let initPromise: Promise<any> | null = null;

async function bootstrapServer(): Promise<any> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('v1');
  app.use(securityHeadersMiddleware);

  // خلف Vercel / Cloudflare / Caddy: نثق بـ Proxy للحصول على IP الحقيقي
  const isProduction = process.env.NODE_ENV === 'production';
  const trustProxyRaw = process.env.TRUST_PROXY;
  const trustProxy =
    trustProxyRaw === undefined
      ? isProduction
        ? true
        : 0
      : trustProxyRaw === 'true'
        ? true
        : trustProxyRaw === 'false'
          ? false
          : Number(trustProxyRaw);
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);

  // إعطاء الأولوية لهيدرات الـ IP الحقيقي على Vercel / Cloudflare
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

  app.enableCors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
      : true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
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

  await app.init();
  new Logger('VercelServerless').log('تمت تهيئة مَقوتي Serverless بنجاح');
  return app.getHttpAdapter().getInstance();
}

export default async function handler(req: any, res: any) {
  if (!cachedHandler) {
    if (!initPromise) {
      initPromise = bootstrapServer();
    }
    cachedHandler = await initPromise;
  }

  // استعادة المسار الأصلي في بيئة Vercel Serverless عند استخدام rewrites
  if (req.headers && req.headers['x-matched-path'] && typeof req.headers['x-matched-path'] === 'string') {
    req.url = req.headers['x-matched-path'];
  } else if (req.originalUrl && req.url !== req.originalUrl) {
    req.url = req.originalUrl;
  }

  return cachedHandler(req, res);
}
