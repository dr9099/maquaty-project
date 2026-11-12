import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

// فحص صحة الخدمة — عام بلا مصادقة، ولا يكشف أي بيانات أعمال
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'maquaty-backend',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.round(process.uptime()),
    };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ready',
        database: 'up',
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException('قاعدة البيانات غير جاهزة.');
    }
  }
}
