import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

// المحافظ الإلكترونية (كريمي، جيب، ون كاش...) — إنشاء حساب فرعي 1100-x لكل محفظة في دليل الحسابات
@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(storeOwnerId: string, dto: { name: string }) {
    const duplicate = await this.prisma.wallet.findFirst({
      where: { storeOwnerId, name: dto.name, isActive: true },
    });
    if (duplicate) {
      throw ApiError.conflict('VALIDATION_ERROR', 'توجد محفظة بهذا الاسم بالفعل.');
    }

    const wallet = await this.prisma.$transaction(async (tx) => {
      const created = await tx.wallet.create({
        data: { storeOwnerId, name: dto.name },
      });
      // حساب فرعي تحت 1100 المحافظ الإلكترونية
      const count = await tx.chartOfAccount.count({
        where: { storeOwnerId, code: { startsWith: '11' } },
      });
      await tx.chartOfAccount.create({
        data: {
          storeOwnerId,
          code: `110${count + 1}`,
          name: `محفظة: ${dto.name}`,
          accountType: 'ASSET',
        },
      });
      return created;
    });
    return wallet;
  }

  async list(storeOwnerId: string) {
    return this.prisma.wallet.findMany({
      where: { storeOwnerId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
  }
}
