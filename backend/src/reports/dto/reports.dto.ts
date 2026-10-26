import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum ReportType {
  SALES = 'sales',
  PURCHASES = 'purchases',
  EXPENSES = 'expenses',
  WITHDRAWALS = 'withdrawals',
}

export class QueryReportsDto {
  @IsEnum(ReportType, {
    message: 'نوع التقرير يجب أن يكون sales أو purchases أو expenses أو withdrawals.',
  })
  @IsNotEmpty({ message: 'نوع التقرير مطلوب.' })
  type: ReportType;

  @IsOptional()
  @IsString()
  date_from?: string;

  @IsOptional()
  @IsString()
  date_to?: string;

  @IsOptional()
  @IsString()
  format?: 'json' | 'pdf' | 'excel';
}
