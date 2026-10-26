import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { WalletsService } from './wallets.service';

@Module({
  controllers: [ItemsController],
  providers: [ItemsService, WalletsService],
  exports: [ItemsService],
})
export class ItemsModule {}
