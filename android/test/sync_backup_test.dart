import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:muqawati_app/core/constants/api_endpoints.dart';
import 'package:muqawati_app/core/network/api_client.dart';
import 'package:muqawati_app/data/local/app_database.dart';
import 'package:muqawati_app/data/models/auth_account.dart';
import 'package:muqawati_app/data/repositories/auth_repository.dart';
import 'package:muqawati_app/presentation/providers/auth_provider.dart';
import 'package:muqawati_app/presentation/providers/credit_provider.dart';
import 'package:muqawati_app/presentation/providers/inventory_provider.dart';
import 'package:muqawati_app/presentation/providers/purchases_provider.dart';
import 'package:muqawati_app/presentation/providers/sales_provider.dart';
import 'package:muqawati_app/presentation/providers/store_settings_provider.dart';
import 'package:muqawati_app/presentation/providers/suppliers_provider.dart';
import 'package:muqawati_app/presentation/providers/sync_provider.dart';
import 'package:muqawati_app/presentation/screens/auth/account_locked_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

/// عميل شبكة وهمي يحاكي انقطاع الاتصال (NETWORK_ERROR) واستجابة المزامنة POST /v1/device/sync
class FakeOfflineSyncApiClient extends ApiClient {
  bool isOffline = true;
  String minAppVersionResponse = '1.0.0';
  String accountStatusResponse = 'ACTIVE';
  int syncVersionCounter = 100;
  Map<String, String> forcedOperationStatus = {};
  Map<String, String> forcedOperationErrorCode = {};
  Map<String, dynamic> nextServerUpdates = {};
  final List<Map<String, dynamic>> receivedSyncPayloads = [];
  final List<String> uploadedFiles = [];

  FakeOfflineSyncApiClient() : super(baseUrl: 'http://127.0.0.1:3000');

  @override
  Future<String> uploadFile(String filePath) async {
    if (isOffline) {
      throw ApiException(code: 'NETWORK_ERROR', message: 'لا يوجد اتصال بالإنترنت لرفع الملف');
    }
    uploadedFiles.add(filePath);
    final filename = filePath.split(RegExp(r'[\\/]')).last;
    return '/v1/uploads/server-$filename';
  }

  @override
  Future<Response> get(String path, {Map<String, dynamic>? queryParameters}) async {
    if (isOffline) {
      throw ApiException(code: 'NETWORK_ERROR', message: 'لا يوجد اتصال بالإنترنت');
    }
    return Response(
      requestOptions: RequestOptions(path: path),
      statusCode: 200,
      data: [],
    );
  }

  @override
  Future<Response> post(
    String path, {
    dynamic data,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    if (isOffline) {
      throw ApiException(code: 'NETWORK_ERROR', message: 'لا يوجد اتصال بالإنترنت');
    }

    if (path == ApiEndpoints.deviceSync) {
      final body = data is Map<String, dynamic>
          ? data
          : Map<String, dynamic>.from(data as Map);
      receivedSyncPayloads.add(body);
      final pending = (body['pendingLocalOperations'] as List?) ?? [];
      final processed = <Map<String, dynamic>>[];

      for (final rawOp in pending) {
        final op = Map<String, dynamic>.from(rawOp as Map);
        final clientOpId = op['clientOpId']?.toString() ?? '';
        final status = forcedOperationStatus[clientOpId] ?? 'ACCEPTED';
        final errCode = forcedOperationErrorCode[clientOpId];
        processed.add({
          'client_op_id': clientOpId,
          'status': status,
          if (errCode != null) 'error_code': errCode,
        });
      }

      syncVersionCounter += 1;
      return Response(
        requestOptions: RequestOptions(path: path),
        statusCode: 200,
        data: {
          'new_sync_version': syncVersionCounter,
          'account_status': accountStatusResponse,
          'min_app_version': minAppVersionResponse,
          'processed_operations': processed,
          'server_updates': nextServerUpdates,
        },
      );
    }

    return Response(
      requestOptions: RequestOptions(path: path),
      statusCode: 201,
      data: data is Map ? data : {},
    );
  }
}

/// قاعدة بيانات SQLite في الذاكرة تحاكي جداول AppDatabase بالكامل لأغراض اختبارات الوحدة
class FakeMemoryDatabase implements Database {
  final Map<String, List<Map<String, dynamic>>> _tables = {
    'items': [],
    'sales': [],
    'credit_customers': [],
    'credit_transactions': [],
    'daily_closing': [],
    'sync_queue': [],
    'store_settings': [],
    'suppliers': [],
    'purchase_invoices': [],
    'purchase_items': [],
    'supplier_payments': [],
    'purchase_returns': [],
    'owner_transactions': [],
    'wallet_settlements': [],
  };

  int _syncQueueAutoId = 0;
  bool _open = true;

  List<Map<String, dynamic>> tableRows(String table) => _tables[table] ?? [];

  @override
  bool get isOpen => _open;

  @override
  String get path => ':memory:';

  @override
  Future<void> close() async {
    _open = false;
  }

  @override
  Future<int> insert(
    String table,
    Map<String, Object?> values, {
    String? nullColumnHack,
    ConflictAlgorithm? conflictAlgorithm,
  }) async {
    final rows = _tables.putIfAbsent(table, () => []);
    final row = Map<String, dynamic>.from(values);

    if (table == 'sync_queue') {
      final clientOpId = row['client_op_id']?.toString();
      final existingIdx = rows.indexWhere((r) => r['client_op_id'] == clientOpId);
      if (existingIdx != -1) {
        if (conflictAlgorithm == ConflictAlgorithm.ignore) {
          return rows[existingIdx]['id'] as int;
        }
        if (conflictAlgorithm == ConflictAlgorithm.replace) {
          _syncQueueAutoId += 1;
          row['id'] = _syncQueueAutoId;
          rows[existingIdx] = row;
          return _syncQueueAutoId;
        }
      }
      _syncQueueAutoId += 1;
      row['id'] = _syncQueueAutoId;
      rows.add(row);
      return _syncQueueAutoId;
    }

    final pkKey = table == 'store_settings' ? 'key' : 'id';
    final pkVal = row[pkKey];
    if (pkVal != null) {
      final idx = rows.indexWhere((r) => r[pkKey] == pkVal);
      if (idx != -1) {
        if (conflictAlgorithm == ConflictAlgorithm.ignore) {
          return idx;
        }
        rows[idx] = row;
        return idx + 1;
      }
    }
    rows.add(row);
    return rows.length;
  }

  bool _matchesWhere(
    Map<String, dynamic> row,
    String? where,
    List<Object?>? whereArgs,
  ) {
    if (where == null || where.trim().isEmpty) return true;
    final args = whereArgs ?? const [];
    final w = where.trim();

    if (w == 'status = ?') {
      return row['status'] == args[0];
    }
    if (w == 'client_op_id = ?') {
      return row['client_op_id'] == args[0];
    }
    if (w == 'id = ?') {
      return row['id'] == args[0];
    }
    if (w == 'key = ?') {
      return row['key'] == args[0];
    }
    if (w == 'id = ? AND deleted_at IS NULL') {
      return row['id'] == args[0] && row['deleted_at'] == null;
    }
    if (w == 'LOWER(name) = ? AND deleted_at IS NULL') {
      return (row['name']?.toString().toLowerCase() ?? '') == args[0] &&
          row['deleted_at'] == null;
    }
    if (w == 'deleted_at IS NULL') {
      return row['deleted_at'] == null;
    }
    if (w == 'synced = 0') {
      return (row['synced'] as int? ?? 1) == 0;
    }
    if (w == 'client_op_id = ? OR id = ?' || w == 'id = ? OR client_op_id = ?') {
      return row['client_op_id'] == args[0] || row['id'] == args[1];
    }
    if (w == 'id = ? AND purchase_invoice_id = ?') {
      return row['id'] == args[0] && row['purchase_invoice_id'] == args[1];
    }
    if (w == 'purchase_invoice_id = ?') {
      return row['purchase_invoice_id'] == args[0];
    }
    return true;
  }

  @override
  Future<List<Map<String, Object?>>> query(
    String table, {
    bool? distinct,
    List<String>? columns,
    String? where,
    List<Object?>? whereArgs,
    String? groupBy,
    String? having,
    String? orderBy,
    int? limit,
    int? offset,
  }) async {
    final rows = _tables[table] ?? [];
    var filtered = rows
        .where((r) => _matchesWhere(r, where, whereArgs))
        .map((r) => Map<String, Object?>.from(r))
        .toList();

    if (orderBy == 'id ASC') {
      filtered.sort(
        (a, b) => ((a['id'] as int?) ?? 0).compareTo((b['id'] as int?) ?? 0),
      );
    }
    if (limit != null && filtered.length > limit) {
      filtered = filtered.sublist(0, limit);
    }
    return filtered;
  }

  @override
  Future<int> update(
    String table,
    Map<String, Object?> values, {
    String? where,
    List<Object?>? whereArgs,
    ConflictAlgorithm? conflictAlgorithm,
  }) async {
    final rows = _tables[table] ?? [];
    var count = 0;
    for (final row in rows) {
      if (_matchesWhere(row, where, whereArgs)) {
        row.addAll(values);
        count += 1;
      }
    }
    return count;
  }

  @override
  Future<int> delete(
    String table, {
    String? where,
    List<Object?>? whereArgs,
  }) async {
    final rows = _tables[table] ?? [];
    final beforeLen = rows.length;
    rows.removeWhere((row) => _matchesWhere(row, where, whereArgs));
    return beforeLen - rows.length;
  }

  @override
  Future<List<Map<String, Object?>>> rawQuery(
    String sql, [
    List<Object?>? arguments,
  ]) async {
    if (sql.contains("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'")) {
      final pending = (_tables['sync_queue'] ?? [])
          .where((r) => r['status'] == 'PENDING')
          .length;
      return [
        {'count': pending}
      ];
    }
    if (sql.contains('FROM sales s')) {
      final sales = _tables['sales'] ?? [];
      final items = _tables['items'] ?? [];
      return sales.map((s) {
        final item = items.firstWhere(
          (i) => i['id'] == s['item_id'],
          orElse: () => {'name': 'صنف', 'unit': 'كيلو'},
        );
        return <String, Object?>{
          ...s,
          'item_name': item['name'],
          'unit': item['unit'],
        };
      }).toList();
    }
    return [];
  }

  @override
  Future<T> transaction<T>(
    Future<T> Function(Transaction txn) action, {
    bool? exclusive,
  }) async {
    return await action(_FakeTransaction(this));
  }

  @override
  Batch batch() => _FakeBatch(this);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeTransaction implements Transaction {
  final FakeMemoryDatabase _db;
  _FakeTransaction(this._db);

  @override
  Future<int> insert(
    String table,
    Map<String, Object?> values, {
    String? nullColumnHack,
    ConflictAlgorithm? conflictAlgorithm,
  }) =>
      _db.insert(
        table,
        values,
        nullColumnHack: nullColumnHack,
        conflictAlgorithm: conflictAlgorithm,
      );

  @override
  Future<List<Map<String, Object?>>> query(
    String table, {
    bool? distinct,
    List<String>? columns,
    String? where,
    List<Object?>? whereArgs,
    String? groupBy,
    String? having,
    String? orderBy,
    int? limit,
    int? offset,
  }) =>
      _db.query(
        table,
        distinct: distinct,
        columns: columns,
        where: where,
        whereArgs: whereArgs,
        groupBy: groupBy,
        having: having,
        orderBy: orderBy,
        limit: limit,
        offset: offset,
      );

  @override
  Future<int> update(
    String table,
    Map<String, Object?> values, {
    String? where,
    List<Object?>? whereArgs,
    ConflictAlgorithm? conflictAlgorithm,
  }) =>
      _db.update(
        table,
        values,
        where: where,
        whereArgs: whereArgs,
        conflictAlgorithm: conflictAlgorithm,
      );

  @override
  Future<int> delete(String table, {String? where, List<Object?>? whereArgs}) =>
      _db.delete(table, where: where, whereArgs: whereArgs);

  @override
  Batch batch() => _db.batch();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeBatch implements Batch {
  final FakeMemoryDatabase _db;
  final List<Future<void> Function()> _ops = [];

  _FakeBatch(this._db);

  @override
  void insert(
    String table,
    Map<String, Object?> values, {
    String? nullColumnHack,
    ConflictAlgorithm? conflictAlgorithm,
  }) {
    _ops.add(() => _db.insert(
          table,
          values,
          nullColumnHack: nullColumnHack,
          conflictAlgorithm: conflictAlgorithm,
        ));
  }

  @override
  void update(
    String table,
    Map<String, Object?> values, {
    String? where,
    List<Object?>? whereArgs,
    ConflictAlgorithm? conflictAlgorithm,
  }) {
    _ops.add(() => _db.update(
          table,
          values,
          where: where,
          whereArgs: whereArgs,
          conflictAlgorithm: conflictAlgorithm,
        ));
  }

  @override
  void delete(String table, {String? where, List<Object?>? whereArgs}) {
    _ops.add(() => _db.delete(table, where: where, whereArgs: whereArgs));
  }

  @override
  Future<List<Object?>> commit({
    bool? exclusive,
    bool? noResult,
    bool? continueOnError,
  }) async {
    for (final op in _ops) {
      await op();
    }
    return [];
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const storeOwnerId = 'owner-phase3-test';
  late FakeMemoryDatabase fakeDb;
  late FakeOfflineSyncApiClient fakeApi;

  setUp(() async {
    SharedPreferences.setMockInitialValues({
      'cached_device_fingerprint': 'DEV-FLUTTER-PHASE3-123456',
    });
    fakeDb = FakeMemoryDatabase();
    fakeApi = FakeOfflineSyncApiClient();
    AppDatabase.setInstanceForTesting(storeOwnerId, fakeDb);

    // تهيئة بيانات أولية في SQLite الوهمي
    await fakeDb.insert('items', {
      'id': 'item-1',
      'name': 'قات همداني رقم 1',
      'unit': 'كيلو',
      'quantity': 25.0,
      'sell_price': 6000.0,
      'cost_price': 4000.0,
      'emergency_price_mode': 'RANGE_OR_OPEN',
      'deleted_at': null,
    });
    await fakeDb.insert('credit_customers', {
      'id': 'cust-1',
      'name': 'صالح العميل',
      'phone': '771122334',
      'credit_limit': 50000.0,
      'total_debt': 12000.0,
    });
    await fakeDb.insert('suppliers', {
      'id': 'sup-1',
      'name': 'مورد همدان',
      'phone': '775566778',
      'opening_balance': 0.0,
      'current_balance': 0.0,
      'status': 'ACTIVE',
      'synced': 1,
    });
  });

  group('اختبارات صلاحيات ومحرك المزامنة والنسخ الاحتياطي (Sync & Backup Rules)', () {
    test('1. فحص الصلاحيات R-12 و BR-010: المالك والعامل المسؤول يملكان canAccessBackup، والعامل العادي ممنوع', () {
      final ownerAccount = AuthAccount(
        id: 'owner-uuid-1',
        phone: '777111222',
        displayName: 'مالك المتجر',
        storeName: 'متجر مَقوتي',
        role: 'STORE_OWNER',
        accountStatus: 'ACTIVE',
        accessToken: 'mock-token',
        refreshToken: 'mock-refresh',
        lastActiveAt: DateTime.now(),
      );

      final respWorkerAccount = AuthAccount(
        id: 'worker-uuid-2',
        phone: '777333444',
        displayName: 'عامل مسؤول',
        storeName: 'متجر مَقوتي',
        role: 'WORKER',
        isResponsibleWorker: true,
        accountStatus: 'ACTIVE',
        accessToken: 'mock-token',
        refreshToken: 'mock-refresh',
        lastActiveAt: DateTime.now(),
      );

      final normalWorkerAccount = AuthAccount(
        id: 'worker-uuid-3',
        phone: '777555666',
        displayName: 'عامل عادي',
        storeName: 'متجر مَقوتي',
        role: 'WORKER',
        isResponsibleWorker: false,
        accountStatus: 'ACTIVE',
        accessToken: 'mock-token',
        refreshToken: 'mock-refresh',
        lastActiveAt: DateTime.now(),
      );

      final client = ApiClient(baseUrl: 'http://127.0.0.1:3000');
      final repo = AuthRepository(client);
      final authProvider = AuthProvider(repo);

      authProvider.setCurrentAccountForTesting(ownerAccount);
      expect(authProvider.canAccessBackup, isTrue);
      expect(authProvider.isSubscribed, isTrue);

      authProvider.setCurrentAccountForTesting(respWorkerAccount);
      expect(authProvider.canAccessBackup, isTrue);
      expect(authProvider.isSubscribed, isTrue);

      authProvider.setCurrentAccountForTesting(normalWorkerAccount);
      expect(authProvider.canAccessBackup, isFalse);
      expect(authProvider.isSubscribed, isTrue);
    });

    test('2. فحص حالة الاشتراك BR-076 و R-28: الحساب التجريبي ليس مشتركاً نشطاً (isSubscribed = false)', () {
      final trialAccount = AuthAccount(
        id: 'owner-uuid-trial',
        phone: '777000111',
        displayName: 'مالك تجريبي',
        storeName: 'متجر تجريبي',
        role: 'STORE_OWNER',
        accountStatus: 'TRIAL',
        accessToken: 'mock-token',
        refreshToken: 'mock-refresh',
        lastActiveAt: DateTime.now(),
      );

      final client = ApiClient(baseUrl: 'http://127.0.0.1:3000');
      final repo = AuthRepository(client);
      final authProvider = AuthProvider(repo);

      authProvider.setCurrentAccountForTesting(trialAccount);
      expect(authProvider.canAccessBackup, isTrue);
      expect(authProvider.isSubscribed, isFalse);
    });
  });

  group('المرحلة الثالثة — طابور العمليات الأوفلاين والمزامنة (Phase 3 Offline Queue & Sync)', () {
    test('1-4. Offline Sales (نقدي، إلكتروني، آجل، واضطراري) تُحفظ محلياً وتُدرج في sync_queue وتُزال عند المزامنة', () async {
      final salesProvider = SalesProvider(fakeApi);
      final syncProvider = SyncProvider(fakeApi);

      // 1) بيع نقدي أوفلاين
      final okCash = await salesProvider.createSale(
        itemId: 'item-1',
        quantity: 2,
        quantityUnit: 'KILO',
        amount: 12000,
        paymentType: 'CASH',
        storeOwnerId: storeOwnerId,
        clientOpId: '11111111-1111-4111-8111-111111111111',
      );
      expect(okCash, isTrue);

      // 2) بيع إلكتروني أوفلاين
      final okElec = await salesProvider.createSale(
        itemId: 'item-1',
        quantity: 1,
        quantityUnit: 'KILO',
        amount: 6000,
        paymentType: 'ELECTRONIC',
        walletId: 'wallet-1',
        depositAttachmentUrl: '/local/receipt.jpg',
        storeOwnerId: storeOwnerId,
        clientOpId: '22222222-2222-4222-8222-222222222222',
      );
      expect(okElec, isTrue);

      // 3) بيع آجل أوفلاين
      final okCredit = await salesProvider.createSale(
        itemId: 'item-1',
        quantity: 3,
        quantityUnit: 'KILO',
        amount: 18000,
        paymentType: 'CREDIT',
        creditCustomerId: 'cust-1',
        storeOwnerId: storeOwnerId,
        isOwner: true,
        clientOpId: '33333333-3333-4333-8333-333333333333',
      );
      expect(okCredit, isTrue);

      // 4) بيع اضطراري أوفلاين
      final okEmerg = await salesProvider.createSale(
        itemId: 'item-1',
        quantity: 1,
        quantityUnit: 'KILO',
        amount: 4500,
        paymentType: 'CASH',
        isEmergencySale: true,
        emergencyOverridePrice: 4500,
        emergencyReason: 'تصريف آخر النهار',
        storeOwnerId: storeOwnerId,
        clientOpId: '44444444-4444-4444-8444-444444444444',
      );
      expect(okEmerg, isTrue);

      // التحقق من خصم المخزون محلياً (25 - 2 - 1 - 3 - 1 = 18)
      final itemRow = fakeDb.tableRows('items').first;
      expect(itemRow['quantity'], equals(18.0));

      // التحقق من زيادة دين العميل محلياً (12,000 + 18,000 = 30,000)
      final custRow = fakeDb.tableRows('credit_customers').first;
      expect(custRow['total_debt'], equals(30000.0));

      // التحقق من وجود 4 عمليات في sync_queue
      final pendingBefore = await AppDatabase.getPendingOperations(fakeDb);
      expect(pendingBefore.length, equals(4));

      // تنفيذ المزامنة عند عودة الإنترنت
      fakeApi.isOffline = false;
      final syncRes = await syncProvider.syncWithServer(storeOwnerId: storeOwnerId);
      expect(syncRes.success, isTrue);
      expect(syncRes.processedCount, equals(4));

      // تم تفريغ الطابور وتحديث synced = 1 في جدول sales
      expect(await AppDatabase.getPendingCount(fakeDb), equals(0));
      for (final s in fakeDb.tableRows('sales')) {
        expect(s['synced'], equals(1));
      }
    });

    test('5. Offline Credit Collection (CREDIT_PAYMENT) يخفض دين العميل محلياً مرة واحدة فقط ويزامن بأمان', () async {
      final creditProvider = CreditProvider(fakeApi);
      final syncProvider = SyncProvider(fakeApi);
      const opId = '55555555-5555-4555-8555-555555555555';

      final ok1 = await creditProvider.collectDebt(
        customerId: 'cust-1',
        amount: 5000,
        paymentMethod: 'CASH',
        notes: 'تحصيل نقدي أوفلاين',
        storeOwnerId: storeOwnerId,
        clientOpId: opId,
      );
      expect(ok1, isTrue);

      // إعادة استدعاء نفس العملية بنفس clientOpId لا يخصم الدين مرتين
      final ok2 = await creditProvider.collectDebt(
        customerId: 'cust-1',
        amount: 5000,
        paymentMethod: 'CASH',
        notes: 'تحصيل نقدي أوفلاين',
        storeOwnerId: storeOwnerId,
        clientOpId: opId,
      );
      expect(ok2, isTrue);

      final custRow = fakeDb.tableRows('credit_customers').first;
      expect(custRow['total_debt'], equals(7000.0)); // 12,000 - 5,000 = 7,000 فقط

      final pending = await AppDatabase.getPendingOperations(fakeDb);
      expect(pending.length, equals(1));
      expect(pending.first['op_type'], equals('CREDIT_PAYMENT'));
      expect(pending.first['client_op_id'], equals(opId));

      fakeApi.isOffline = false;
      final res = await syncProvider.syncWithServer(storeOwnerId: storeOwnerId);
      expect(res.success, isTrue);
      expect(await AppDatabase.getPendingCount(fakeDb), equals(0));
    });

    test('6. Offline Damaged Goods (DAMAGED_GOODS) يخصم المخزون محلياً ويحفظ في الطابور دون تكرار', () async {
      final inventoryProvider = InventoryProvider(fakeApi);
      const opId = '66666666-6666-4666-8666-666666666666';

      final ok = await inventoryProvider.recordDamagedGoods(
        itemId: 'item-1',
        quantity: 3,
        reason: 'تلف أثناء النقل',
        photoUrl: '/local/damaged.jpg',
        storeOwnerId: storeOwnerId,
        clientOpId: opId,
      );
      expect(ok, isTrue);

      // إعادة المحاولة بنفس المعرف لا تخصم مرتين
      await inventoryProvider.recordDamagedGoods(
        itemId: 'item-1',
        quantity: 3,
        reason: 'تلف أثناء النقل',
        photoUrl: '/local/damaged.jpg',
        storeOwnerId: storeOwnerId,
        clientOpId: opId,
      );

      final itemRow = fakeDb.tableRows('items').first;
      expect(itemRow['quantity'], equals(22.0)); // 25 - 3 = 22

      final pending = await AppDatabase.getPendingOperations(fakeDb);
      expect(pending.length, equals(1));
      expect(pending.first['op_type'], equals('DAMAGED_GOODS'));
    });

    test('7-8. Offline Purchase و Offline Purchase Return يحفظان البنود ويفصلان invoiceId عن clientOpId ويحدثان المخزون', () async {
      final purchasesProvider = PurchasesProvider(fakeApi);
      const invId = '77777777-7777-4777-8777-777777777777';
      const purchaseClientOpId = '88888888-8888-4888-8888-888888888888';
      const lineId = '99999999-9999-4999-8999-999999999999';

      final createdInvoice = await purchasesProvider.createPurchase(
        invoiceId: invId,
        clientOpId: purchaseClientOpId,
        supplierId: 'sup-1',
        supplierNameForOffline: 'مورد همدان',
        paymentType: 'CREDIT',
        status: 'POSTED',
        storeOwnerId: storeOwnerId,
        items: const [
          PurchaseLineInput(
            id: lineId,
            itemId: 'item-1',
            itemName: 'قات همداني رقم 1',
            unit: 'كيلو',
            baseUnit: 'كيلو',
            conversionFactor: 1.0,
            quantity: 10.0,
            unitCostPrice: 4000.0,
            sellPrice: 6000.0,
          ),
        ],
      );

      expect(createdInvoice, isNotNull);
      expect(createdInvoice!.id, equals(invId));
      expect(createdInvoice.items.length, equals(1));
      expect(createdInvoice.items.first.id, equals(lineId));

      // التحقق من فصل invoiceId عن clientOpId في جدول purchase_invoices و sync_queue
      final dbInvoice = fakeDb.tableRows('purchase_invoices').first;
      expect(dbInvoice['id'], equals(invId));
      expect(dbInvoice['client_op_id'], equals(purchaseClientOpId));

      final pendingAfterPurchase = await AppDatabase.getPendingOperations(fakeDb);
      expect(pendingAfterPurchase.length, equals(1));
      expect(pendingAfterPurchase.first['client_op_id'], equals(purchaseClientOpId));
      final queuedPurchasePayload =
          jsonDecode(pendingAfterPurchase.first['payload'] as String) as Map<String, dynamic>;
      expect(queuedPurchasePayload['id'], equals(invId));
      expect(queuedPurchasePayload['clientOpId'], equals(purchaseClientOpId));

      // المخزون المحلي زاد من 25 إلى 35، وذمة المورد زادت إلى 40,000
      expect(fakeDb.tableRows('items').first['quantity'], equals(35.0));
      expect(fakeDb.tableRows('suppliers').first['current_balance'], equals(40000.0));

      // الآن تسجيل مرتجع مشتريات أوفلاين على نفس البند (4 كيلو من أصل 10)
      const returnOpId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      final okReturn = await purchasesProvider.createReturn(
        invoiceId: invId,
        purchaseItemId: lineId,
        quantity: 4.0,
        quantityUnit: 'KILO',
        refundMethod: 'DEBT_REDUCTION',
        reason: 'أوراق تالفة في الربطة',
        storeOwnerId: storeOwnerId,
        clientOpId: returnOpId,
      );
      expect(okReturn, isTrue);

      // التحقق من تحديث المخزون (35 - 4 = 31) والكمية المرتجعة (4) وذمة المورد (40,000 - 16,000 = 24,000)
      expect(fakeDb.tableRows('items').first['quantity'], equals(31.0));
      expect(fakeDb.tableRows('purchase_items').first['returned_quantity'], equals(4.0));
      expect(fakeDb.tableRows('purchase_invoices').first['remaining_amount'], equals(24000.0));
      expect(fakeDb.tableRows('suppliers').first['current_balance'], equals(24000.0));

      // منع إرجاع كمية تتجاوز المتبقي (المتبقي 6 كيلو، محاولة إرجاع 7 كيلو تفشل)
      final failExcessReturn = await purchasesProvider.createReturn(
        invoiceId: invId,
        purchaseItemId: lineId,
        quantity: 7.0,
        quantityUnit: 'KILO',
        refundMethod: 'DEBT_REDUCTION',
        reason: 'محاولة تجاوز المتبقي',
        storeOwnerId: storeOwnerId,
      );
      expect(failExcessReturn, isFalse);
      expect(purchasesProvider.errorCode, equals('RETURN_QTY_EXCEEDS_PURCHASED'));
    });

    test('9-10. Rejected Offline Operations و Retry Idempotency: تحافظ على ترتيب الطابور وتعلّم المرفوضة كـ REJECTED', () async {
      await AppDatabase.enqueueOperation(
        fakeDb,
        clientOpId: 'op-first',
        opType: 'SALE',
        payload: {'id': 'op-first', 'amount': 5000},
      );
      await AppDatabase.enqueueOperation(
        fakeDb,
        clientOpId: 'op-second-rejected',
        opType: 'SALE',
        payload: {'id': 'op-second-rejected', 'amount': 99000},
      );

      // إعادة استدعاء enqueueOperation لنفس clientOpId لا يغير رقم id ولا الترتيب الزمني
      await AppDatabase.enqueueOperation(
        fakeDb,
        clientOpId: 'op-first',
        opType: 'SALE',
        payload: {'id': 'op-first', 'amount': 5000},
      );

      final pendingBefore = await AppDatabase.getPendingOperations(fakeDb);
      expect(pendingBefore.length, equals(2));
      expect(pendingBefore[0]['client_op_id'], equals('op-first'));
      expect(pendingBefore[1]['client_op_id'], equals('op-second-rejected'));

      fakeApi.isOffline = false;
      fakeApi.forcedOperationStatus['op-first'] = 'ACCEPTED';
      fakeApi.forcedOperationStatus['op-second-rejected'] = 'REJECTED';
      fakeApi.forcedOperationErrorCode['op-second-rejected'] = 'CREDIT_LIMIT_EXCEEDED';

      final syncProvider = SyncProvider(fakeApi);
      final res = await syncProvider.syncWithServer(storeOwnerId: storeOwnerId);
      expect(res.success, isTrue);

      // العملية المقبولة حُذفت، والمرفوضة تحولت إلى REJECTED مع حفظ رمز الخطأ
      expect(await AppDatabase.getPendingCount(fakeDb), equals(0));
      final queueRows = fakeDb.tableRows('sync_queue');
      expect(queueRows.length, equals(1));
      expect(queueRows.first['client_op_id'], equals('op-second-rejected'));
      expect(queueRows.first['status'], equals('REJECTED'));
      expect(
        queueRows.first['error_message']?.toString(),
        contains('CREDIT_LIMIT_EXCEEDED'),
      );
    });

    test('11-12. applyServerUpdates يحدّث purchases و workers ويحمي العمليات المحلية المعلّقة من الكتابة الفوقية', () async {
      // عملية بيع معلّقة على item-1 خفضت كميته محلياً إلى 19.0
      await fakeDb.update('items', {'quantity': 19.0}, where: 'id = ?', whereArgs: ['item-1']);
      await AppDatabase.enqueueOperation(
        fakeDb,
        clientOpId: 'pending-sale-item-1',
        opType: 'SALE',
        payload: {'itemId': 'item-1', 'quantity': 6.0},
      );

      // تطبيق server_updates تحتوي على كمية قديمة للصنف item-1 (25.0) + فواتير مشتريات + قائمة عمال
      await AppDatabase.applyServerUpdates(fakeDb, {
        'items': [
          {
            'id': 'item-1',
            'name': 'قات همداني رقم 1',
            'unit': 'كيلو',
            'quantity': 25.0, // كمية قديمة من الخادم قبل مزامنة العملية المعلقة
            'sell_price': 6500.0,
            'cost_price': 4200.0,
          },
        ],
        'purchases': [
          {
            'id': 'srv-inv-1',
            'invoice_number': 'PUR-20261109-0001',
            'supplier_id': 'sup-1',
            'invoice_date': '2026-11-09T00:00:00.000Z',
            'payment_type': 'CASH',
            'total_amount': 50000.0,
            'paid_amount': 50000.0,
            'remaining_amount': 0.0,
            'status': 'POSTED',
            'costing_method_used': 'WEIGHTED_AVERAGE',
          },
        ],
        'workers': [
          {
            'id': 'worker-srv-1',
            'full_name': 'أحمد العامل المسؤول',
            'phone': '771234567',
            'status': 'ACTIVE',
            'is_responsible': true,
          },
        ],
      });

      // الكمية المحلية للصنف ذي العملية المعلقة لم تُستبدل بالكمية القديمة (بقيت 19.0)
      final itemAfter = fakeDb.tableRows('items').first;
      expect(itemAfter['quantity'], equals(19.0));
      expect(itemAfter['sell_price'], equals(6500.0));

      // تم حفظ فاتورة المشتريات القادمة من الخادم
      final invoices = fakeDb.tableRows('purchase_invoices');
      expect(invoices.length, equals(1));
      expect(invoices.first['id'], equals('srv-inv-1'));
      expect(invoices.first['invoice_number'], equals('PUR-20261109-0001'));

      // تم حفظ قائمة العمال محلياً ويمكن قراءتها عبر AppDatabase.getWorkers
      final workers = await AppDatabase.getWorkers(fakeDb);
      expect(workers.length, equals(1));
      expect(workers.first['full_name'], equals('أحمد العامل المسؤول'));
    });

    test('13-14. فحص min_app_version: يمنع الاستخدام ويقفل التطبيق عند وجود إصدار أقدم، ويسمح بالإصدار المطابق أو الأحدث', () async {
      fakeApi.isOffline = false;
      final authRepo = AuthRepository(fakeApi);
      final authProvider = AuthProvider(authRepo);
      authProvider.setCurrentAccountForTesting(
        AuthAccount(
          id: storeOwnerId,
          phone: '777111222',
          displayName: 'مالك المتجر',
          storeName: 'متجر مَقوتي',
          role: 'STORE_OWNER',
          accountStatus: 'ACTIVE',
          accessToken: 'tok',
          refreshToken: 'ref',
          lastActiveAt: DateTime.now(),
        ),
      );

      final syncProvider = SyncProvider(fakeApi, currentAppVersion: '1.0.0');

      // 1) إصدار مطابق (1.0.0) -> مسموح
      fakeApi.minAppVersionResponse = '1.0.0';
      final okRes = await syncProvider.syncWithServer(
        storeOwnerId: storeOwnerId,
        onMinVersionRequired: (minVer) => authProvider.lockForAppUpdate(minVer),
      );
      expect(okRes.updateRequired, isFalse);
      expect(syncProvider.isUpdateRequired, isFalse);
      expect(authProvider.status, equals(AuthStatus.authenticated));

      // 2) الخادم يطلب إصداراً أحدث (1.4.0) -> يُقفل التطبيق فوراً ويطلب التحديث
      fakeApi.minAppVersionResponse = '1.4.0';
      final lockRes = await syncProvider.syncWithServer(
        storeOwnerId: storeOwnerId,
        onMinVersionRequired: (minVer) => authProvider.lockForAppUpdate(minVer),
      );
      expect(lockRes.updateRequired, isTrue);
      expect(syncProvider.isUpdateRequired, isTrue);
      expect(syncProvider.minAppVersion, equals('1.4.0'));
      expect(authProvider.status, equals(AuthStatus.accountLocked));
      expect(authProvider.isAppUpdateRequired, isTrue);
      expect(authProvider.lockReason, contains('1.4.0'));
    });

    test('15. المرحلة السابعة — رفع المرفقات المحلية قبل المزامنة واستبدالها برابط الخادم (Offline Attachment Upload)', () async {
      // 1) إدراج عملية بيع إلكترونية في الطابور بمسار ملف محلي على الجهاز
      const localFilePath = '/data/user/0/com.kareemtech.maquaty/cache/local_receipt_99.jpg';
      const clientOpId = 'op-attach-upload-1';
      await AppDatabase.enqueueOperation(
        fakeDb,
        clientOpId: clientOpId,
        opType: 'SALE',
        payload: {
          'id': clientOpId,
          'clientOpId': clientOpId,
          'itemId': 'item-1',
          'quantity': 1.0,
          'amount': 5000.0,
          'paymentType': 'ELECTRONIC',
          'walletId': 'wallet-1',
          'depositAttachmentUrl': localFilePath,
        },
      );

      // 2) أثناء المزامنة عبر SyncProvider
      fakeApi.isOffline = false;
      fakeApi.uploadedFiles.clear();
      fakeApi.receivedSyncPayloads.clear();

      final syncProvider = SyncProvider(fakeApi);
      final res = await syncProvider.syncWithServer(storeOwnerId: storeOwnerId);
      expect(res.success, isTrue);

      // تحقق من أنه تم استدعاء uploadFile للملف المحلي
      expect(fakeApi.uploadedFiles.contains(localFilePath), isTrue);

      // تحقق من أن البايلود المرسل للسيرفر يحتوي على رابط الخادم وليس المسار المحلي
      expect(fakeApi.receivedSyncPayloads.isNotEmpty, isTrue);
      final sentPending = fakeApi.receivedSyncPayloads.first['pendingLocalOperations'] as List;
      final sentSale = sentPending.firstWhere((e) => e['clientOpId'] == clientOpId);
      final sentAttachmentUrl = sentSale['payload']['depositAttachmentUrl'] as String;
      expect(sentAttachmentUrl.startsWith('/v1/uploads/'), isTrue);
      expect(sentAttachmentUrl, equals('/v1/uploads/server-local_receipt_99.jpg'));
    });

    test('16. المرحلة السابعة — استخراج رقم الدعم وقفل الحساب ودعم واتساب (Support Phone & WhatsApp)', () async {
      final authRepo = AuthRepository(fakeApi);
      final authProvider = AuthProvider(authRepo);

      // 1) محاكاة استلام 423 مع details تحتوي contact_phone و contact_whatsapp
      authProvider.setCurrentAccountForTesting(
        AuthAccount(
          id: storeOwnerId,
          phone: '777000111',
          displayName: 'مالك منتهي',
          storeName: 'متجر مَقوتي',
          role: 'STORE_OWNER',
          accountStatus: 'TRIAL_EXPIRED',
          accessToken: 'tok',
          refreshToken: 'ref',
          lastActiveAt: DateTime.now(),
        ),
      );

      await authProvider.updateAccountStatus(
        'TRIAL_EXPIRED',
        contactPhone: '777889900',
        contactWhatsapp: '777889900',
      );

      expect(authProvider.status, equals(AuthStatus.accountLocked));
      expect(authProvider.supportPhone, equals('777889900'));
      expect(authProvider.contactWhatsapp, equals('777889900'));

      // 2) فحص دالة extractSupportPhone
      final extracted = AccountLockedScreen.extractSupportPhone('انتهت التجربة للتواصل والدعم: 777889900');
      expect(extracted, equals('777889900'));
    });

    test('17. المرحلة السابعة — ثبات العملة (SAR / USD) في وضع الأوفلاين عبر StoreSettingsProvider و SuppliersProvider', () async {
      // 1) حفظ إعدادات المتجر كـ ريال سعودي (SAR)
      await AppDatabase.setStoreSetting(fakeDb, 'currency', 'SAR');
      await AppDatabase.setStoreSetting(fakeDb, 'currency_symbol', 'ر.س');
      await AppDatabase.setStoreSetting(fakeDb, 'default_costing_method', 'FIFO');

      // 2) محاكاة فتح StoreSettingsProvider في وضع الأوفلاين
      fakeApi.isOffline = true;
      final storeSettings = StoreSettingsProvider(fakeApi);
      expect(storeSettings.currency, equals('YER')); // البداية الافتراضية
      await storeSettings.fetchSettings(storeOwnerId: storeOwnerId);

      // تحقق من قراءة SAR من الـ DB المحلي عند فشل الشبكة
      expect(storeSettings.currency, equals('SAR'));
      expect(storeSettings.currencySymbol, equals('ر.س'));
      expect(storeSettings.defaultCostingMethod, equals('FIFO'));

      // 3) إدراج مورد محلي بدون أعمدة العملة
      await fakeDb.insert('suppliers', {
        'id': 'sup-sar-1',
        'name': 'مورد مزارع صعدة',
        'phone': '777333444',
        'opening_balance': 1000.0,
        'current_balance': 1500.0,
        'status': 'ACTIVE',
        'synced': 1,
      });

      final suppliersProv = SuppliersProvider(fakeApi);
      await suppliersProv.fetchSuppliers(storeOwnerId: storeOwnerId);

      // تحقق من أن SuppliersProvider حقن SAR و ر.س بدلاً من YER
      expect(suppliersProv.currency, equals('SAR'));
      expect(suppliersProv.currencySymbol, equals('ر.س'));
      expect(suppliersProv.suppliers.isNotEmpty, isTrue);
      expect(suppliersProv.suppliers.first.currency, equals('SAR'));
      expect(suppliersProv.suppliers.first.currencySymbol, equals('ر.س'));
    });
  });
}
