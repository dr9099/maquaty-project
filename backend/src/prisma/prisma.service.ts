import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// طبقة الوصول الوحيدة لقاعدة البيانات — كل استعلام يمر من هنا
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('تم الاتصال بقاعدة البيانات بنجاح');
    } catch (error) {
      // لا يُوقف الإقلاع إذا لم تكن قاعدة البيانات جاهزة بعد (التنفيذ يدوياً لاحقاً)
      this.logger.warn(
        `تعذر الاتصال بقاعدة البيانات الآن (سيُعاد عند أول استعلام): ${(error as Error).message}`,
      );
    }
  }
}
