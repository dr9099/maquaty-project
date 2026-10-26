import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AccountingModule } from './accounting/accounting.module';
import { AuthModule } from './auth/auth.module';
import { ItemsModule } from './items/items.module';
import { SalesModule } from './sales/sales.module';

// مَقوتي — Central Backend Server
// المرحلة 1 ✓ (قاعدة البيانات + Auth + عزل Tenant + دليل الحسابات)
// المرحلة 2 ✓ (الأصناف + البيع + المخزون + المحاسبة التلقائية)
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AccountingModule,
    AuthModule,
    ItemsModule,
    SalesModule,
    // المراحل التالية: Workers (م3) / Credit+Expenses+DailyClosing (م4) /
    // Sync+Dashboard+Rejected (م5) / Subscription+Admin (م6) / Backup (م7) / Broadcasts (م8)
  ],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
