import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { randomUUID } from 'node:crypto';

export type JobHandler = (payload: any) => Promise<void>;

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private readonly workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  private isRunning = false;
  private pollTimer?: NodeJS.Timeout;
  private cronTimer?: NodeJS.Timeout;
  private readonly handlers = new Map<string, JobHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    this.registerDefaultHandlers();
  }

  onModuleInit() {
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  registerHandler(queueName: string, handler: JobHandler) {
    this.handlers.set(queueName, handler);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.log(`بدء تشغيل عامل المهام (Worker): ${this.workerId}`);

    // بدء حلقة السحب الفوري (polling) كل 5 ثوانٍ للمهام في الطابور
    this.pollLoop();

    // تشغيل المهام الدورية التلقائية كل 5 دقائق
    this.runCronTasks();
    this.cronTimer = setInterval(() => {
      this.runCronTasks().catch((err) =>
        this.logger.error('خطأ أثناء تشغيل المهام الدورية:', err),
      );
    }, 5 * 60 * 1000);
  }

  stop() {
    this.isRunning = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.cronTimer) clearInterval(this.cronTimer);
    this.logger.log(`تم إيقاف عامل المهام: ${this.workerId}`);
  }

  async enqueue(queueName: string, payload: Record<string, unknown>, runAt?: Date) {
    return this.prisma.job.create({
      data: {
        queueName,
        payload: payload as Prisma.InputJsonValue,
        runAt: runAt ?? new Date(),
        status: 'PENDING',
      },
    });
  }

  private async pollLoop() {
    if (!this.isRunning) return;

    try {
      const processed = await this.processNextJob();
      // إذا تمت معالجة مهمة بنجاح، نحاول سحب التالية فوراً؛ وإلا ننتظر 5 ثوانٍ
      const delay = processed ? 500 : 5000;
      this.pollTimer = setTimeout(() => this.pollLoop(), delay);
    } catch (error) {
      this.logger.error('خطأ أثناء سحب المهام من الطابور:', error);
      this.pollTimer = setTimeout(() => this.pollLoop(), 5000);
    }
  }

  private async processNextJob(): Promise<boolean> {
    // 1) قفل ذري لمهمة واحدة مستحقة عبر FOR UPDATE SKIP LOCKED
    const candidate = await this.prisma.$queryRaw<Array<{ id: string; queue_name: string; payload: any; attempts: number; max_attempts: number }>>`
      WITH next_job AS (
        SELECT id
        FROM jobs
        WHERE status = 'PENDING'
          AND run_at <= NOW()
        ORDER BY run_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs
      SET status = 'PROCESSING',
          locked_at = NOW(),
          locked_by = ${this.workerId},
          attempts = attempts + 1,
          updated_at = NOW()
      FROM next_job
      WHERE jobs.id = next_job.id
      RETURNING jobs.id, jobs.queue_name, jobs.payload, jobs.attempts, jobs.max_attempts;
    `;

    if (!candidate || candidate.length === 0) {
      return false;
    }

    const job = candidate[0];
    const handler = this.handlers.get(job.queue_name);

    if (!handler) {
      this.logger.warn(`لا يوجد handler مسجل للطابور: ${job.queue_name}`);
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: `No handler registered for queue: ${job.queue_name}`,
          lockedAt: null,
          lockedBy: null,
        },
      });
      return true;
    }

    try {
      await handler(job.payload);
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          lockedAt: null,
          lockedBy: null,
          errorMessage: null,
        },
      });
      return true;
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      this.logger.error(`فشل تنفيذ المهمة [${job.id}] في ${job.queue_name}: ${errorMsg}`);

      const hasMoreAttempts = job.attempts < job.max_attempts;
      const backoffMinutes = Math.pow(2, job.attempts); // exponential backoff
      const nextRunAt = hasMoreAttempts ? new Date(Date.now() + backoffMinutes * 60 * 1000) : new Date();

      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: hasMoreAttempts ? 'PENDING' : 'FAILED',
          errorMessage: errorMsg,
          runAt: nextRunAt,
          lockedAt: null,
          lockedBy: null,
        },
      });
      return true;
    }
  }

  // ─── المهام الدورية المعتمدة ───────────────────────────────────────────

  private registerDefaultHandlers() {
    this.registerHandler('check_expired_subscriptions', async () => {
      await this.checkExpiredSubscriptions();
    });

    this.registerHandler('cleanup_expired_tokens', async () => {
      await this.cleanupExpiredTokens();
    });

    this.registerHandler('reclaim_stuck_jobs', async () => {
      await this.reclaimStuckJobs();
    });

    this.registerHandler('retention_cleanup', async () => {
      await this.retentionCleanup();
    });
  }

  async runCronTasks() {
    await this.reclaimStuckJobs();
    await this.checkExpiredSubscriptions();
    await this.cleanupExpiredTokens();
    await this.retentionCleanup();
  }

  /**
   * 1. فحص وإنهاء الاشتراكات المنتهية دورياً (D-08 معتمد)
   */
  async checkExpiredSubscriptions(): Promise<number> {
    const now = new Date();
    const expiredSubs = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lte: now },
        storeOwner: {
          status: { not: 'SUSPENDED' }, // تجميد عداد الاشتراك أثناء الإيقاف الإداري لضمان حق التعويض (R-52 / D-07)
        },
      },
      include: {
        storeOwner: {
          select: { id: true, status: true },
        },
      },
      take: 100,
    });

    let count = 0;
    for (const sub of expiredSubs) {
      await this.prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: 'EXPIRED' },
        });

        // إذا كان المتجر نشطاً، يُحول إلى EXPIRED (ولا نلمس المتجر إن كان موقوفاً إدارياً)
        if (sub.storeOwner.status === 'ACTIVE') {
          await tx.storeOwner.update({
            where: { id: sub.storeOwner.id },
            data: { status: 'EXPIRED' },
          });
        }
      });

      await this.audit.log({
        actorType: 'SYSTEM',
        actionType: 'SUBSCRIPTION_EXPIRED_AUTO',
        targetType: 'store_owner',
        targetId: sub.storeOwner.id,
        oldValue: { subscription_id: sub.id, expires_at: sub.expiresAt },
        newValue: { status: 'EXPIRED' },
        result: 'SUCCESS',
      });

      count++;
    }

    if (count > 0) {
      this.logger.log(`تم إنهاء ${count} اشتراك منتهٍ تلقائياً.`);
    }

    return count;
  }

  /**
   * 2. تنظيف الجلسات المنتهية والأكواد المؤقتة
   */
  async cleanupExpiredTokens(): Promise<void> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

    // حذف الجلسات المنتهية الصلاحية أو الملغاة منذ أكثر من 7 أيام
    await this.prisma.refreshSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { lt: sevenDaysAgo } },
        ],
      },
    });

    // حذف سجلات كلمات المرور المؤقتة المنتهية منذ أكثر من 7 أيام
    await this.prisma.tempPasswordAudit.deleteMany({
      where: {
        expiresAt: { lt: sevenDaysAgo },
      },
    });
  }

  /**
   * 3. استرداد المهام العالقة في PROCESSING لأكثر من 15 دقيقة
   */
  async reclaimStuckJobs(): Promise<number> {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const result = await this.prisma.$executeRaw`
      UPDATE jobs
      SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED'::"JobStatus" ELSE 'PENDING'::"JobStatus" END,
          error_message = CASE WHEN attempts >= max_attempts THEN 'تجاوزت المهمة الحد الأقصى للمحاولات بعد انقطاع مفاجئ' ELSE 'استرداد تلقائي لمهمة عالقة في المعالجة' END,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
      WHERE status = 'PROCESSING'
        AND locked_at <= ${fifteenMinutesAgo};
    `;

    if (Number(result) > 0) {
      this.logger.warn(`تم استرداد ${result} مهمة عالقة في المعالجة.`);
    }
    return Number(result);
  }

  /**
   * 4. تنظيف المهام القديمة (حفظ المكتمل 7 أيام والفاشل 30 يوماً)
   */
  async retentionCleanup(): Promise<void> {
    const completedThreshold = new Date(Date.now() - 7 * 86400000);
    const failedThreshold = new Date(Date.now() - 30 * 86400000);

    await this.prisma.job.deleteMany({
      where: {
        status: 'COMPLETED',
        updatedAt: { lt: completedThreshold },
      },
    });

    await this.prisma.job.deleteMany({
      where: {
        status: 'FAILED',
        updatedAt: { lt: failedThreshold },
      },
    });
  }
}
