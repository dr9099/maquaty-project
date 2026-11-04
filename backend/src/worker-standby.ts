import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';

const logger = new Logger('WorkerDaemon');

async function bootstrap() {
  logger.log('بدء تشغيل عامل المهام في الخلفية (Background Worker)...');
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const shutdown = async (signal: string) => {
    logger.log(`استُلم ${signal} — إيقاف Worker بأمان.`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('فشل بدء تشغيل Worker:', err);
  process.exit(1);
});
