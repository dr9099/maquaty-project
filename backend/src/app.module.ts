import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AccountingModule } from './accounting/accounting.module';
import { AuthModule } from './auth/auth.module';

// مَقوتي — Central Backend Server
// المرحلة 1 (Backend Core): قاعدة البيانات + Auth + عزل Tenant + زراعة دليل الحسابات
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AccountingModule,
    AuthModule,
    // المراحل التالية: Workers / Items+Sales / Credit / Expenses / DailyClosing /
    // Sync+Dashboard / Subscription / Backup / Broadcasts / RejectedTransactions
  ],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
