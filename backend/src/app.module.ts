import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { AccountStatusGuard } from './common/account-status.guard';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AccountingModule } from './accounting/accounting.module';
import { AuthModule } from './auth/auth.module';
import { ItemsModule } from './items/items.module';
import { SalesModule } from './sales/sales.module';
import { WorkersModule } from './workers/workers.module';
import { CreditModule } from './credit/credit.module';
import { ExpensesModule } from './expenses/expenses.module';
import { DailyClosingModule } from './daily-closing/daily-closing.module';
import { DamagedGoodsModule } from './damaged-goods/damaged-goods.module';

// مَقوتي — Central Backend Server
// المرحلة 1 ✓ (قاعدة البيانات + Auth + عزل Tenant + دليل الحسابات)
// المرحلة 2 ✓ (الأصناف + البيع + المخزون + المحاسبة التلقائية + المرتجعات)
// المرحلة 3 ✓ (العمال والصلاحيات + المسؤول + الموافقات R-33 + RBAC خادمي كامل)
// المرحلة 4 ✓ (الآجل + المصروفات + التالف + المطابقة والإغلاق اليومي)
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AccountingModule,
    AuthModule,
    ItemsModule,
    SalesModule,
    WorkersModule,
    CreditModule,
    ExpensesModule,
    DailyClosingModule,
    DamagedGoodsModule,
    // المراحل اللاحقة: Sync+Dashboard+Rejected (م5) / Subscription+Admin (م6) / Backup (م7) / Broadcasts (م8)
  ],
  providers: [
    // الترتيب ملزم: المصادقة أولاً ثم فحص حالة الحساب عند كل طلب (12-business §3)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccountStatusGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
