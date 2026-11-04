// عامل احتياطي مؤقت — لا يقرأ ولا يكتب قاعدة البيانات ولا ينفّذ أي مهام.
// يُستبدل لاحقاً بعامل الطابور الفعلي بعد اعتماد جدول jobs (قرار مستقل — R-48).
import { Logger } from '@nestjs/common';

const logger = new Logger('WorkerStandby');

logger.warn(
  'Worker في وضع الانتظار: لم يُفعّل طابور المهام بعد. العملية ستبقى حيّة دون تنفيذ أي مهمة.',
);

const keepAlive = setInterval(() => undefined, 60_000);

function shutdown(signal: string) {
  logger.log(`استُلم ${signal} — إيقاف Worker الاحتياطي.`);
  clearInterval(keepAlive);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
