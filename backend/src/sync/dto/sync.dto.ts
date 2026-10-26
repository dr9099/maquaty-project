import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { BroadcastAckType } from '@prisma/client';

export class LocalOperationDto {
  @IsString({ message: 'معرف العملية من العميل مطلوب.' })
  @IsNotEmpty({ message: 'معرف العملية من العميل مطلوب.' })
  clientOpId: string;

  @IsString({ message: 'نوع العملية مطلوب.' })
  @IsNotEmpty({ message: 'نوع العملية مطلوب.' })
  opType: string; // SALE, CREDIT_PAYMENT, DAMAGED_GOODS, WORKER_ADVANCE

  @IsObject({ message: 'بيانات العملية يجب أن تكون كائناً.' })
  payload: Record<string, any>;

  @IsOptional()
  @IsString()
  createdAt?: string;
}

export class DeviceSyncDto {
  @IsString({ message: 'بصمة الجهاز مطلوبة.' })
  @IsNotEmpty({ message: 'بصمة الجهاز مطلوبة.' })
  deviceFingerprint: string;

  @IsOptional()
  @IsNumber({}, { message: 'رقم إصدار المزامنة يجب أن يكون رقماً.' })
  lastSyncVersion?: number;

  @IsOptional()
  @IsArray({ message: 'قائمة العمليات المحلية يجب أن تكون مصفوفة.' })
  @ValidateNested({ each: true })
  @Type(() => LocalOperationDto)
  pendingLocalOperations?: LocalOperationDto[];
}

export class PullBroadcastsDto {
  @IsString({ message: 'بصمة الجهاز مطلوبة.' })
  @IsNotEmpty({ message: 'بصمة الجهاز مطلوبة.' })
  deviceFingerprint: string;

  @IsOptional()
  @IsString()
  pairingStatus?: string;
}

export class AckBroadcastDto {
  @IsEnum(BroadcastAckType, { message: 'نوع الإشعار يجب أن يكون VIEW أو CLICK.' })
  ackType: BroadcastAckType;

  @IsString({ message: 'بصمة الجهاز مطلوبة.' })
  @IsNotEmpty({ message: 'بصمة الجهاز مطلوبة.' })
  deviceFingerprint: string;
}
