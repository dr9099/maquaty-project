import 'dart:async';
import 'package:dio/dio.dart';
import '../constants/api_endpoints.dart';
import '../storage/secure_storage_service.dart';

/// استثناء خاص بأخطاء خادم مَقوتي
class ApiException implements Exception {
  final String code;
  final String message;
  final dynamic details;
  final int? statusCode;

  ApiException({
    required this.code,
    required this.message,
    this.details,
    this.statusCode,
  });

  @override
  String toString() => message;
}

/// عميل الشبكة الموحد للنظام مع التجديد التلقائي للتوكن (R-02) وعزل الحسابات (R-35)
class ApiClient {
  late final Dio _dio;
  final SecureStorageService _storage = SecureStorageService();
  String _baseUrl = ApiEndpoints.defaultBaseUrl;
  bool _isRefreshing = false;

  ApiClient({String? baseUrl}) {
    if (baseUrl != null) _baseUrl = baseUrl;
    _dio = Dio(BaseOptions(
      baseUrl: _baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    ));

    _setupInterceptors();
  }

  void setBaseUrl(String url) {
    _baseUrl = url;
    _dio.options.baseUrl = url;
  }

  void _setupInterceptors() {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final activeAccount = await _storage.getActiveAccount();
        if (activeAccount != null && activeAccount.accessToken.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer ${activeAccount.accessToken}';
        }
        // بصمة الجهاز المعتمدة
        options.headers['X-Device-Fingerprint'] = 'APP-DEVICE-DEFAULT';
        return handler.next(options);
      },
      onError: (DioException error, handler) async {
        final response = error.response;

        // في حال 401 ومحاولة التدوير التلقائي Refresh Token Rotation (R-02)
        if (response?.statusCode == 401 &&
            !error.requestOptions.path.contains(ApiEndpoints.login) &&
            !error.requestOptions.path.contains(ApiEndpoints.refreshToken) &&
            !_isRefreshing) {
          _isRefreshing = true;
          try {
            final activeAccount = await _storage.getActiveAccount();
            if (activeAccount != null && activeAccount.refreshToken.isNotEmpty) {
              final refreshResponse = await _dio.post(
                ApiEndpoints.refreshToken,
                data: {'refreshToken': activeAccount.refreshToken},
                options: Options(headers: {'Authorization': null}),
              );

              if (refreshResponse.statusCode == 200 || refreshResponse.statusCode == 201) {
                final newAccess = refreshResponse.data['accessToken'];
                final newRefresh = refreshResponse.data['refreshToken'];

                final updatedAccount = activeAccount.copyWith(
                  accessToken: newAccess,
                  refreshToken: newRefresh,
                );
                await _storage.saveAccount(updatedAccount, setActive: true);

                // إعادة المحاولة بالتوكن الجديد
                final opts = error.requestOptions;
                opts.headers['Authorization'] = 'Bearer $newAccess';
                final cloneReq = await _dio.request(
                  opts.path,
                  options: Options(
                    method: opts.method,
                    headers: opts.headers,
                  ),
                  data: opts.data,
                  queryParameters: opts.queryParameters,
                );
                _isRefreshing = false;
                return handler.resolve(cloneReq);
              }
            }
          } catch (_) {
            _isRefreshing = false;
          } finally {
            _isRefreshing = false;
          }
        }

        // تحويل استجابة الخادم إلى ApiException
        if (response?.data != null && response?.data is Map) {
          final errData = response!.data['error'];
          if (errData != null) {
            return handler.reject(DioException(
              requestOptions: error.requestOptions,
              response: response,
              error: ApiException(
                code: errData['code'] ?? 'UNKNOWN_ERROR',
                message: errData['message'] ?? 'حدث خطأ غير متوقع',
                details: errData['details'],
                statusCode: response.statusCode,
              ),
            ));
          }
        }

        return handler.next(error);
      },
    ));
  }

  Future<Response> get(String path, {Map<String, dynamic>? queryParameters}) async {
    try {
      return await _dio.get(path, queryParameters: queryParameters);
    } on DioException catch (e) {
      if (e.error is ApiException) throw e.error!;
      throw ApiException(code: 'NETWORK_ERROR', message: 'تعذر الاتصال بالخادم.');
    }
  }

  Future<Response> post(String path, {dynamic data, Map<String, dynamic>? queryParameters}) async {
    try {
      return await _dio.post(path, data: data, queryParameters: queryParameters);
    } on DioException catch (e) {
      if (e.error is ApiException) throw e.error!;
      throw ApiException(code: 'NETWORK_ERROR', message: 'تعذر الاتصال بالخادم.');
    }
  }

  Future<Response> patch(String path, {dynamic data}) async {
    try {
      return await _dio.patch(path, data: data);
    } on DioException catch (e) {
      if (e.error is ApiException) throw e.error!;
      throw ApiException(code: 'NETWORK_ERROR', message: 'تعذر الاتصال بالخادم.');
    }
  }

  Future<Response> delete(String path, {dynamic data}) async {
    try {
      return await _dio.delete(path, data: data);
    } on DioException catch (e) {
      if (e.error is ApiException) throw e.error!;
      throw ApiException(code: 'NETWORK_ERROR', message: 'تعذر الاتصال بالخادم.');
    }
  }
}
