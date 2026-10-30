import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// زراعة دليل الحسابات التلقائية عند إنشاء store_owner جديد — 12-business-logic.md القسم 4
// (20 حساباً أساسياً شاملة الموردين 2000، المصروفات المستحقة 2100، جاري المالك 3100، ومصروفات أخرى 5700)
const CHART_OF_ACCOUNTS: Array<{ code: string; name: string; type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' }> = [
  { code: '1000', name: 'الصندوق', type: 'ASSET' },
  { code: '1100', name: 'المحافظ الإلكترونية', type: 'ASSET' }, // حساب أب؛ حساب فرعي لكل wallet
  { code: '1200', name: 'ذمم العملاء / الآجل', type: 'ASSET' },
  { code: '1300', name: 'المخزون', type: 'ASSET' },
  { code: '2000', name: 'الموردون / الذمم الدائنة', type: 'LIABILITY' },
  { code: '2100', name: 'مصروفات مستحقة', type: 'LIABILITY' },
  { code: '3000', name: 'رأس المال', type: 'EQUITY' },
  { code: '3100', name: 'جاري المالك (مسحوبات وإيداعات المالك)', type: 'EQUITY' },
  { code: '3900', name: 'الأرباح المحتجزة', type: 'EQUITY' },
  { code: '4000', name: 'المبيعات', type: 'REVENUE' },
  { code: '4300', name: 'فائض الصندوق', type: 'REVENUE' },
  { code: '5000', name: 'تكلفة البضاعة المباعة', type: 'EXPENSE' },
  { code: '5100', name: 'مصروف الأجور', type: 'EXPENSE' },
  { code: '5200', name: 'مصروف الإيجار', type: 'EXPENSE' },
  { code: '5300', name: 'مصروف الخدمات', type: 'EXPENSE' },
  { code: '5400', name: 'مصروف التالف', type: 'EXPENSE' },
  { code: '5450', name: 'خسائر البيع الاضطراري', type: 'EXPENSE' },
  { code: '5500', name: 'سلف الموظفين', type: 'ASSET' },
  { code: '5600', name: 'عجز الصندوق', type: 'EXPENSE' },
  { code: '5700', name: 'مصروفات أخرى', type: 'EXPENSE' },
];

@Injectable()
export class ChartOfAccountsService {
  private readonly logger = new Logger(ChartOfAccountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // تُزرع تلقائياً لكل store_owner جديد ضمن نفس معاملة إنشاء الحساب
  async seedForOwner(storeOwnerId: string): Promise<void> {
    await this.prisma.chartOfAccount.createMany({
      data: CHART_OF_ACCOUNTS.map((a) => ({
        storeOwnerId,
        code: a.code,
        name: a.name,
        accountType: a.type,
      })),
      skipDuplicates: true,
    });
    this.logger.log(`تمت زراعة دليل الحسابات للحساب ${storeOwnerId}`);
  }
}
