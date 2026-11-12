import 'dart:async';
import 'package:dio/dio.dart';
import '../constants/api_endpoints.dart';
import '../services/device_info_service.dart';
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
  Future<String?>? _refreshFuture;

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

  Future<String?> _performTokenRefresh(String fingerprint) async {
    try {
      final activeAccount = await _storage.getActiveAccount();
      if (activeAccount != null && activeAccount.refreshToken.isNotEmpty) {
        final tokenDio = Dio(_dio.options);
        final refreshResponse = await tokenDio.post(
          ApiEndpoints.refreshToken,
          data: {'refreshToken': activeAccount.refreshToken},
          options: Options(headers: {
            'Authorization': null,
            'X-Device-Fingerprint': fingerprint,
          }),
        );

        if (refreshResponse.statusCode == 200 || refreshResponse.statusCode == 201) {
          final newAccess = (refreshResponse.data['access_token'] ??
                  refreshResponse.data['accessToken'] ??
                  '')
              .toString();
          final newRefresh = (refreshResponse.data['refresh_token'] ??
                  refreshResponse.data['refreshToken'] ??
                  '')
              .toString();

          final updatedAccount = activeAccount.copyWith(
            accessToken: newAccess,
            refreshToken: newRefresh,
          );
          await _storage.saveAccount(updatedAccount, setActive: true);
          return newAccess;
        }
      }
    } catch (_) {}
    return null;
  }

  void _setupInterceptors() {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final activeAccount = await _storage.getActiveAccount();
        if (options.headers['Authorization'] == null &&
            activeAccount != null &&
            activeAccount.accessToken.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer ${activeAccount.accessToken}';
        }
        // استخراج بصمة الجهاز الفعلية ديناميكياً من الكاش مباشرة (R-25)
        final fingerprint = await DeviceInfoService.getDeviceFingerprint();
        options.headers['X-Device-Fingerprint'] = fingerprint;
        return handler.next(options);
      },
      onError: (DioException error, handler) async {
        final response = error.response;

        // في حال 401 ومحاولة التدوير التلقائي Single-Flight Refresh Token Rotation (R-02)
        if (response?.statusCode == 401 &&
            !error.requestOptions.path.contains(ApiEndpoints.login) &&
            !error.requestOptions.path.contains(ApiEndpoints.refreshToken)) {
          try {
            final fingerprint = await DeviceInfoService.getDeviceFingerprint();
            _refreshFuture ??= _performTokenRefresh(fingerprint).whenComplete(() {
              _refreshFuture = null;
            });

            final newAccess = await _refreshFuture;
            if (newAccess != null && newAccess.isNotEmpty) {
              final tokenDio = Dio(_dio.options);
              final opts = error.requestOptions;
              opts.headers['Authorization'] = 'Bearer $newAccess';
              opts.headers['X-Device-Fingerprint'] = fingerprint;
              final cloneReq = await tokenDio.request(
                opts.path,
                options: Options(
                  method: opts.method,
                  headers: opts.headers,
                  responseType: opts.responseType,
                  contentType: opts.contentType,
                  validateStatus: opts.validateStatus,
                  receiveTimeout: opts.receiveTimeout,
                  sendTimeout: opts.sendTimeout,
                  extra: opts.extra,
                ),
                data: opts.data,
                queryParameters: opts.queryParameters,
              );
              return handler.resolve(cloneReq);
            }
          } catch (_) {}
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

  Future<Response> post(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    try {
      return await _dio.post(
        path,
        data: data,
        queryParameters: queryParameters,
        options: options,
      );
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

  Future<String> uploadFile(String filePath) async {
    try {
      final fileName = filePath.split(RegExp(r'[\\/]')).last;
      final formData = FormData.fromMap({
        'file': await MultipartFile.fromFile(filePath, filename: fileName),
      });
      final res = await _dio.post(
        ApiEndpoints.uploads,
        data: formData,
        options: Options(contentType: 'multipart/form-data'),
      );
      if (res.data is Map && res.data['url'] != null) {
        return res.data['url'].toString();
      }
      throw ApiException(code: 'UPLOAD_FAILED', message: 'فشل رفع الملف إلى الخادم.');
    } on DioException catch (e) {
      if (e.error is ApiException) throw e.error!;
      throw ApiException(code: 'NETWORK_ERROR', message: 'تعذر الاتصال بالخادم لرفع الملف.');
    }
  }
}
