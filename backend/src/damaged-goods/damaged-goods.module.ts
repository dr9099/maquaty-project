import { Module } from '@nestjs/common';
import { DamagedGoodsController } from './damaged-goods.controller';
import { DamagedGoodsService } from './damaged-goods.service';

@Module({
  controllers: [DamagedGoodsController],
  providers: [DamagedGoodsService],
  exports: [DamagedGoodsService],
})
export class DamagedGoodsModule {}
