import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiError } from './api-error';

// تحويل كل الاستثناءات إلى شكل الخطأ الموحّد: { error: { code, message, details } }
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: { error: { code: string; message: string; details?: Record<string, unknown> } };

    if (exception instanceof ApiError) {
      statusCode = exception.statusCode;
      body = {
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details ? { details: exception.details } : {}),
        },
      };
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse() as Record<string, unknown>;
      const message =
        typeof res === 'string' ? res : ((res.message as string | string[]) ?? exception.message);
      // كود الخطأ حسب الحالة: 404 يبقى NOT_FOUND، 400 تحقق مدخلات، وما عداها داخلي
      const code =
        statusCode === 404 ? 'NOT_FOUND'
        : statusCode === 401 ? 'INVALID_CREDENTIALS'
        : statusCode === 403 ? 'PERMISSION_DENIED'
        : statusCode === 400 ? 'VALIDATION_ERROR'
        : 'INTERNAL_ERROR';
      body = {
        error: {
          code,
          message: Array.isArray(message) ? message.join('؛ ') : message,
          ...(typeof res !== 'string' && res.details
            ? { details: res.details as Record<string, unknown> }
            : {}),
        },
      };
    } else {
      this.logger.error('خطأ خادم غير متوقع', exception instanceof Error ? exception.stack : String(exception));
      body = { error: { code: 'INTERNAL_ERROR', message: 'حدث خطأ غير متوقع، حاول لاحقاً.' } };
    }

    response.status(statusCode).json(body);
  }
}
