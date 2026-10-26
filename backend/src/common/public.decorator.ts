import { SetMetadata } from '@nestjs/common';

// مسارات عامة لا تتطلب مصادقة (تسجيل/دخول/تحديث التوكن/دخول الأدمن)
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
