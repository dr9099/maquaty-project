import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('v1');

  // خلف Cloudflare / Caddy: نثق بمستوى واحد من الـ Proxy للحصول على IP الحقيقي
  const isProduction = process.env.NODE_ENV === 'production';
  const trustProxyRaw = process.env.TRUST_PROXY;
  const trustProxy =
    trustProxyRaw === undefined
      ? isProduction
        ? 1
        : 0
      : trustProxyRaw === 'true'
        ? 1
        : trustProxyRaw === 'false'
          ? false
          : Number(trustProxyRaw);
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);

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
    ],
    maxAge: 86400,
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
