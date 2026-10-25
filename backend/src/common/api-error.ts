// شكل الخطأ الموحّد (API_SPEC.md): { "error": { "code", "message", "details" } }
// أكواد الأخطاء الموحّدة مرجعها: docs/14-validation-error-handling.md القسم 4
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'PHONE_ALREADY_EXISTS'
  | 'DEVICE_TRIAL_ALREADY_CONSUMED'
  | 'WORKER_LIMIT_REACHED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'PASSWORD_MISMATCH'
  | 'MISSING_DEPOSIT_ATTACHMENT'
  | 'EMERGENCY_REASON_REQUIRED'
  | 'EMERGENCY_PRICE_BELOW_MINIMUM'
  | 'EMERGENCY_PRICE_ABOVE_MAXIMUM'
  | 'INSUFFICIENT_STOCK'
  | 'CREDIT_LIMIT_EXCEEDED'
  | 'NOT_OWN_SALE'
  | 'RETURN_QUANTITY_EXCEEDED'
  | 'RETURN_DAY_PASSED'
  | 'DAY_ALREADY_CLOSED'
  | 'DISALLOWED_RESOLUTION_ACTION'
  | 'RESPONSIBLE_WORKER_EXISTS'
  | 'BACKUP_TENANT_MISMATCH'
  | 'SUBSCRIPTION_REQUIRED'
  | 'DEVICE_BLOCKED'
  | 'INVALID_MFA_CODE'
  | 'MFA_CHALLENGE_EXPIRED'
  | 'INVALID_REFRESH_TOKEN'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  static badRequest(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(code: ApiErrorCode = 'INVALID_CREDENTIALS', message: string) {
    return new ApiError(401, code, message);
  }
  static forbidden(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    return new ApiError(403, code, message, details);
  }
  static notFound(message = 'العنصر المطلوب غير موجود.') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    return new ApiError(409, code, message, details);
  }
  static locked(reason: string, message: string, details?: Record<string, unknown>) {
    // كود 423 ACCOUNT_LOCKED الموحّد مع reason يوجّه التطبيق لشاشة 21 أو 24
    return new ApiError(423, 'ACCOUNT_LOCKED', message, { reason, ...details });
  }
  static internal(message = 'حدث خطأ غير متوقع، حاول لاحقاً.') {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}
