import { Module } from '@nestjs/common';
import { DailyClosingController } from './daily-closing.controller';
import { DailyClosingService } from './daily-closing.service';

@Module({
  controllers: [DailyClosingController],
  providers: [DailyClosingService],
  exports: [DailyClosingService],
})
export class DailyClosingModule {}
