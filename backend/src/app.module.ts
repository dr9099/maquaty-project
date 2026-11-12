import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { AccountStatusGuard } from './common/account-status.guard';
import { RateLimitGuard } from './common/rate-limit.guard';
import { SecurityHeadersMiddleware } from './common/security-headers.middleware';
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
import { RejectedTransactionsModule } from './rejected-transactions/rejected-transactions.module';
import { SyncModule } from './sync/sync.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchasesModule } from './purchases/purchases.module';
import { HealthModule } from './health/health.module';
import { AdminModule } from './admin/admin.module';
import { UploadsModule } from './uploads/uploads.module';

// مَقوتي — Central Backend Server
// المرحلة 1 ✓ (قاعدة البيانات + Auth + عزل Tenant + دليل الحسابات)
// المرحلة 2 ✓ (الأصناف + البيع + المخزون + المحاسبة التلقائية + المرتجعات)
// المرحلة 3 ✓ (العمال والصلاحيات + المسؤول + الموافقات R-33 + RBAC خادمي كامل)
// المرحلة 4 ✓ (الآجل + المصروفات + التالف + المطابقة والإغلاق اليومي)
// المرحلة 5 ✓ (المزامنة Sync Engine + العمليات المرفوضة + لوحة الملخص + الأموال والتقارير)
// المرحلة 6 ✓ (إدارة المنصة والاشتراكات Admin + Worker)
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
    RejectedTransactionsModule,
    SyncModule,
    DashboardModule,
    ReportsModule,
    SettingsModule,
    SuppliersModule,
    PurchasesModule,
    HealthModule,
    AdminModule,
    UploadsModule,
  ],
  providers: [
    // الترتيب ملزم: المصادقة أولاً، ثم محدد المعدل، ثم فحص حالة الحساب عند كل طلب (12-business §3)
    RateLimitGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RateLimitGuard },
    { provide: APP_GUARD, useClass: AccountStatusGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('{*path}');
  }
}
