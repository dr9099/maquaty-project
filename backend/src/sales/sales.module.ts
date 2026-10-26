import { Module } from '@nestjs/common';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  controllers: [SalesController, ReturnsController],
  providers: [SalesService, ReturnsService],
  exports: [SalesService, ReturnsService],
})
export class SalesModule {}
