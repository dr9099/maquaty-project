import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { WorkerService } from './worker.service';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [WorkerService],
  exports: [WorkerService],
})
export class WorkerModule {}
