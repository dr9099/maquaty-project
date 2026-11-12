import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// قاعدة البيانات المحلية SQLite لدعم التشغيل دون اتصال (Offline-first)
/// مع عزل تام لكل متجر في ملف منفصل (R-35)
class AppDatabase {
  static final Map<String, Database> _databases = {};

  @visibleForTesting
  static void setInstanceForTesting(String storeOwnerId, Database db) {
    _databases[storeOwnerId] = db;
  }

  @visibleForTesting
  static Future<void> createAllTablesForTesting(Database db) async {
    await _createTables(db);
    await _createPurchasesAndSuppliersTables(db);
    await _createOwnerAndWalletSettlementTables(db);
  }

  static Future<Database> getInstance(String storeOwnerId) async {
    if (_databases.containsKey(storeOwnerId)) {
      final db = _databases[storeOwnerId]!;
      if (db.isOpen) return db;
    }

    final dbPath = await getDatabasesPath();
    final path = p.join(dbPath, 'muqawati_$storeOwnerId.db');

    final db = await openDatabase(
      path,
      version: 3,
      onCreate: (db, version) async {
        await _createTables(db);
        await _createPurchasesAndSuppliersTables(db);
        await _createOwnerAndWalletSettlementTables(db);
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await _createPurchasesAndSuppliersTables(db);
        }
        if (oldVersion < 3) {
          try {
            await db.execute(
              "ALTER TABLE items ADD COLUMN unit TEXT NOT NULL DEFAULT 'حبة'",
            );
          } catch (_) {}
          await _createOwnerAndWalletSettlementTables(db);
        }
      },
    );

    _databases[storeOwnerId] = db;
    return db;
  }

  static Future<void> _createTables(Database db) async {
    // 1) الأصناف والمخزون
    await db.execute('''
      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'حبة',
        quantity REAL NOT NULL,
        sell_price REAL NOT NULL,
        cost_price REAL,
        emergency_price_mode TEXT,
        emergency_price_min REAL,
        emergency_price_max REAL,
        deleted_at TEXT
      )
    ''');

    // 2) المبيعات المحلية
    await db.execute('''
      CREATE TABLE sales (
        id TEXT PRIMARY KEY,
        client_op_id TEXT UNIQUE,
        item_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        amount REAL NOT NULL,
        payment_type TEXT NOT NULL,
        wallet_id TEXT,
        credit_customer_id TEXT,
        deposit_attachment_url TEXT,
        is_emergency_sale INTEGER NOT NULL DEFAULT 0,
        emergency_override_price REAL,
        emergency_reason TEXT,
        price_difference_loss REAL,
        sold_at TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0
      )
    ''');

    // 3) عملاء الآجل
    await db.execute('''
      CREATE TABLE credit_customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        credit_limit REAL,
        total_debt REAL NOT NULL DEFAULT 0
      )
    ''');

    // 4) حركات الآجل
    await db.execute('''
      CREATE TABLE credit_transactions (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        tx_type TEXT NOT NULL,
        amount REAL NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      )
    ''');

    // 5) الإغلاق والمطابقة اليومية
    await db.execute('''
      CREATE TABLE daily_closing (
        id TEXT PRIMARY KEY,
        closing_date TEXT NOT NULL,
        expected_cash REAL NOT NULL,
        actual_cash REAL,
        difference REAL,
        status TEXT NOT NULL
      )
    ''');

    // 6) طابور المزامنة Offline Queue
    await db.execute('''
      CREATE TABLE sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_op_id TEXT UNIQUE NOT NULL,
        op_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      )
    ''');
  }

  /// جداول المشتريات والموردين وإعدادات المتجر (الإصدار 2 - Offline-first للمالك)
  static Future<void> _createPurchasesAndSuppliersTables(Database db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS store_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    ''');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        contact_person TEXT,
        tax_number TEXT,
        notes TEXT,
        opening_balance REAL NOT NULL DEFAULT 0,
        current_balance REAL NOT NULL DEFAULT 0,
        credit_limit REAL,
        payment_terms_days INTEGER,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        deleted_at TEXT,
        synced INTEGER NOT NULL DEFAULT 1
      )
    ''');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS purchase_invoices (
        id TEXT PRIMARY KEY,
        client_op_id TEXT UNIQUE,
        supplier_id TEXT NOT NULL,
        supplier_name TEXT NOT NULL,
        invoice_number TEXT NOT NULL,
        supplier_invoice_ref TEXT,
        invoice_date TEXT NOT NULL,
        due_date TEXT,
        payment_type TEXT NOT NULL,
        wallet_id TEXT,
        subtotal REAL NOT NULL DEFAULT 0,
        tax_amount REAL NOT NULL DEFAULT 0,
        discount_amount REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL DEFAULT 0,
        paid_amount REAL NOT NULL DEFAULT 0,
        remaining_amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'YER',
        attachment_url TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'POSTED',
        costing_method_used TEXT,
        created_at TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 1
      )
    ''');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS purchase_items (
        id TEXT PRIMARY KEY,
        purchase_invoice_id TEXT NOT NULL,
        item_id TEXT,
        item_name TEXT NOT NULL,
        base_unit TEXT NOT NULL DEFAULT 'حبة',
        unit TEXT NOT NULL DEFAULT 'حبة',
        conversion_factor REAL NOT NULL DEFAULT 1,
        quantity REAL NOT NULL,
        base_quantity REAL NOT NULL,
        unit_cost_price REAL NOT NULL,
        tax_amount REAL NOT NULL DEFAULT 0,
        discount_amount REAL NOT NULL DEFAULT 0,
        total_line_cost REAL NOT NULL,
        sell_price REAL NOT NULL,
        returned_quantity REAL NOT NULL DEFAULT 0
      )
    ''');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS supplier_payments (
        id TEXT PRIMARY KEY,
        client_op_id TEXT UNIQUE,
        supplier_id TEXT NOT NULL,
        purchase_invoice_id TEXT,
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        wallet_id TEXT,
        receipt_attachment_url TEXT,
        notes TEXT,
        paid_at TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 1
      )
    ''');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS purchase_returns (
        id TEXT PRIMARY KEY,
        client_op_id TEXT UNIQUE,
        purchase_invoice_id TEXT NOT NULL,
        purchase_item_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        total_amount REAL NOT NULL,
        refund_method TEXT NOT NULL,
        reason TEXT NOT NULL,
        returned_at TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 1
      )
    ''');
  }

  /// جداول جاري المالك وتسوية المحافظ الإلكترونية (الإصدار 3 - Offline-first)
  static Future<void> _createOwnerAndWalletSettlementTables(Database db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS owner_transactions (
        id TEXT PRIMARY KEY,
        client_op_id TEXT UNIQUE,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'CASH',
        wallet_id TEXT,
        attachment_url TEXT,
        note TEXT,
        transacted_at TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 1
      )
    ''');

    await db.execute('''
      CREATE TABLE IF NOT EXISTS wallet_settlements (
        id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL,
        book_balance_before REAL NOT NULL,
        actual_provider_balance REAL NOT NULL,
        difference REAL NOT NULL,
        cash_out_to_drawer REAL NOT NULL DEFAULT 0,
        notes TEXT,
        settled_at TEXT NOT NULL
      )
    ''');
  }

  // إضافة عملية إلى طابور المزامنة غير المتصل (مع الحفاظ على client_op_id وترتيب الطابور دون تكرار)
  static Future<void> enqueueOperation(
    DatabaseExecutor db, {
    required String clientOpId,
    required String opType,
    required Map<String, dynamic> payload,
  }) async {
    final existing = await db.query(
      'sync_queue',
      columns: ['id', 'status'],
      where: 'client_op_id = ?',
      whereArgs: [clientOpId],
      limit: 1,
    );
    if (existing.isNotEmpty) {
      final status = existing.first['status']?.toString();
      if (status == 'SYNCED') {
        return;
      }
      await db.update(
        'sync_queue',
        {
          'op_type': opType,
          'payload': jsonEncode(payload),
          'status': 'PENDING',
        },
        where: 'client_op_id = ?',
        whereArgs: [clientOpId],
      );
      return;
    }

    await db.insert(
      'sync_queue',
      {
        'client_op_id': clientOpId,
        'op_type': opType,
        'payload': jsonEncode(payload),
        'status': 'PENDING',
        'created_at': DateTime.now().toIso8601String(),
        'retry_count': 0,
      },
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
  }

  // جلب كافة العمليات المعلقة للمزامنة
  static Future<List<Map<String, dynamic>>> getPendingOperations(Database db) async {
    return await db.query(
      'sync_queue',
      where: 'status = ?',
      whereArgs: ['PENDING'],
      orderBy: 'id ASC',
    );
  }

  // تعليم عملية كمكتملة المزامنة
  static Future<void> markOperationSynced(Database db, String clientOpId) async {
    await db.update(
      'sync_queue',
      {'status': 'SYNCED'},
      where: 'client_op_id = ?',
      whereArgs: [clientOpId],
    );
  }

  // إغلاق اتصال قاعدة البيانات لمتجر معين (R-35)
  static Future<void> closeDatabase(String storeOwnerId) async {
    if (_databases.containsKey(storeOwnerId)) {
      final db = _databases[storeOwnerId]!;
      if (db.isOpen) {
        await db.close();
      }
      _databases.remove(storeOwnerId);
    }
  }

  // حساب عدد العمليات المعلقة في طابور المزامنة
  static Future<int> getPendingCount(Database db) async {
    try {
      final result = await db.rawQuery(
        "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'",
      );
      return Sqflite.firstIntValue(result) ?? 0;
    } catch (_) {
      return 0;
    }
  }

  // تحديث العمليات المعالجة بعد المزامنة السحابية (حذف المقبولة وتحديث المرفوضة)
  static Future<void> markOperationsProcessed(
    Database db,
    List<dynamic> processedOps,
  ) async {
    final batch = db.batch();
    for (final op in processedOps) {
      final opMap = op is Map<String, dynamic> ? op : Map<String, dynamic>.from(op as Map);
      final clientOpId = opMap['client_op_id']?.toString();
      final status = opMap['status']?.toString();
      final errorCode = opMap['error_code']?.toString();
      final message = opMap['message']?.toString();

      if (clientOpId == null) continue;

      if (status == 'ACCEPTED') {
        batch.delete('sync_queue', where: 'client_op_id = ?', whereArgs: [clientOpId]);
        batch.update(
          'sales',
          {'synced': 1},
          where: 'client_op_id = ? OR id = ?',
          whereArgs: [clientOpId, clientOpId],
        );
        batch.update(
          'purchase_invoices',
          {'synced': 1},
          where: 'client_op_id = ? OR id = ?',
          whereArgs: [clientOpId, clientOpId],
        );
        batch.update(
          'purchase_returns',
          {'synced': 1},
          where: 'client_op_id = ? OR id = ?',
          whereArgs: [clientOpId, clientOpId],
        );
        batch.update(
          'supplier_payments',
          {'synced': 1},
          where: 'client_op_id = ? OR id = ?',
          whereArgs: [clientOpId, clientOpId],
        );
        batch.update(
          'suppliers',
          {'synced': 1},
          where: 'id = ?',
          whereArgs: [clientOpId],
        );
        batch.update(
          'owner_transactions',
          {'synced': 1},
          where: 'client_op_id = ? OR id = ?',
          whereArgs: [clientOpId, clientOpId],
        );
      } else if (status == 'REJECTED') {
        batch.update(
          'sync_queue',
          {
            'status': 'REJECTED',
            'error_message': '$errorCode: ${message ?? ''}'.trim(),
          },
          where: 'client_op_id = ?',
          whereArgs: [clientOpId],
        );
        // حذف/تسوية أي عملية بيع تفاؤلية غير متزامنة تم رفضها من الخادم
        batch.delete(
          'sales',
          where: '(client_op_id = ? OR id = ?) AND synced = 0',
          whereArgs: [clientOpId, clientOpId],
        );
      }
    }
    await batch.commit(noResult: true);
  }

  // إنشاء نسخة احتياطية محلية فعلية من ملف قاعدة البيانات muqawati_$storeOwnerId.db
  static Future<Map<String, dynamic>> exportLocalBackup(String storeOwnerId) async {
    final db = await getInstance(storeOwnerId);
    try {
      await db.rawQuery('PRAGMA wal_checkpoint(FULL);');
    } catch (_) {}

    final dbPath = await getDatabasesPath();
    final srcPath = p.join(dbPath, 'muqawati_$storeOwnerId.db');
    final srcFile = File(srcPath);

    if (!srcFile.existsSync()) {
      throw Exception('ملف قاعدة البيانات غير موجود على هذا الجهاز.');
    }

    final backupPath = p.join(dbPath, 'muqawati_$storeOwnerId.backup.db');
    final backupFile = await srcFile.copy(backupPath);
    final sizeBytes = await backupFile.length();
    final now = DateTime.now();

    await setStoreSetting(db, 'last_local_backup_at', now.toIso8601String());
    await setStoreSetting(db, 'last_local_backup_size', sizeBytes.toString());
    await setStoreSetting(db, 'last_local_backup_path', backupPath);

    return {
      'path': backupPath,
      'sizeBytes': sizeBytes,
      'createdAt': now,
    };
  }

  // استعادة البيانات من النسخة الاحتياطية المحلية واستبدال قاعدة البيانات الحالية بها
  static Future<bool> restoreFromLocalBackup(String storeOwnerId) async {
    final dbPath = await getDatabasesPath();
    final backupPath = p.join(dbPath, 'muqawati_$storeOwnerId.backup.db');
    final backupFile = File(backupPath);

    if (!backupFile.existsSync()) {
      throw Exception('لا توجد نسخة احتياطية محلية سابقة على هذا الجهاز.');
    }

    // إغلاق اتصال قاعدة البيانات الحالي بأمان قبل الاستبدال
    await closeDatabase(storeOwnerId);

    final targetPath = p.join(dbPath, 'muqawati_$storeOwnerId.db');

    // حذف ملفات WAL و SHM السابقة حتى لا تعيد كتابة البيانات القديمة
    final walFile = File('$targetPath-wal');
    if (walFile.existsSync()) {
      try {
        walFile.deleteSync();
      } catch (_) {}
    }
    final shmFile = File('$targetPath-shm');
    if (shmFile.existsSync()) {
      try {
        shmFile.deleteSync();
      } catch (_) {}
    }

    await backupFile.copy(targetPath);

    // إعادة فتح الاتصال للتحقق من سلامة الملف وحفظ وقت الاستعادة
    final newDb = await getInstance(storeOwnerId);
    await setStoreSetting(newDb, 'last_restore_at', DateTime.now().toIso8601String());

    return true;
  }

  // قراءة بيانات ملف النسخة الاحتياطية المحلي إذا وجد
  static Future<Map<String, dynamic>?> getLocalBackupInfo(String storeOwnerId) async {
    final dbPath = await getDatabasesPath();
    final backupPath = p.join(dbPath, 'muqawati_$storeOwnerId.backup.db');
    final file = File(backupPath);
    if (file.existsSync()) {
      final size = await file.length();
      final mod = await file.lastModified();
      return {
        'path': backupPath,
        'sizeBytes': size,
        'createdAt': mod,
      };
    }
    return null;
  }

  // حفظ إعداد في جدول store_settings
  static Future<void> setStoreSetting(Database db, String key, String value) async {
    await db.insert(
      'store_settings',
      {'key': key, 'value': value},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  // قراءة إعداد من جدول store_settings
  static Future<String?> getStoreSetting(Database db, String key) async {
    final res = await db.query(
      'store_settings',
      where: 'key = ?',
      whereArgs: [key],
      limit: 1,
    );
    if (res.isNotEmpty) {
      return res.first['value']?.toString();
    }
    return null;
  }

  // قراءة قائمة العمال المخزنة محلياً من تحديثات المزامنة
  static Future<List<Map<String, dynamic>>> getWorkers(Database db) async {
    final raw = await getStoreSetting(db, 'workers');
    if (raw == null || raw.trim().isEmpty) return [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is List) {
        return decoded
            .map((e) => e is Map<String, dynamic> ? e : Map<String, dynamic>.from(e as Map))
            .toList();
      }
    } catch (_) {}
    return [];
  }

  // تطبيق تحديثات الخادم (server_updates) على الجداول المحلية مع حماية العمليات المحلية المعلّقة
  static Future<void> applyServerUpdates(
    Database db,
    Map<String, dynamic> updates,
  ) async {
    // جمع معرّفات السجلات التي لديها عمليات معلّقة في طابور المزامنة لمنع الكتابة فوقها ببيانات خادم قديمة
    final pendingOps = await db.query(
      'sync_queue',
      columns: ['client_op_id', 'op_type', 'payload'],
      where: 'status = ?',
      whereArgs: ['PENDING'],
    );

    final pendingItemIds = <String>{};
    final pendingSupplierIds = <String>{};
    final pendingInvoiceIds = <String>{};

    for (final op in pendingOps) {
      final opType = op['op_type']?.toString() ?? '';
      final clientOpId = op['client_op_id']?.toString() ?? '';
      Map<String, dynamic> payload = {};
      try {
        final rawPayload = op['payload']?.toString();
        if (rawPayload != null && rawPayload.isNotEmpty) {
          payload = Map<String, dynamic>.from(jsonDecode(rawPayload) as Map);
        }
      } catch (_) {}

      final itemId = payload['itemId']?.toString() ?? payload['item_id']?.toString();
      if (itemId != null && itemId.isNotEmpty) {
        pendingItemIds.add(itemId);
      }
      if (payload['items'] is List) {
        for (final line in (payload['items'] as List)) {
          if (line is Map) {
            final lineItemId = line['itemId']?.toString() ?? line['item_id']?.toString();
            if (lineItemId != null && lineItemId.isNotEmpty) {
              pendingItemIds.add(lineItemId);
            }
          }
        }
      }

      final supplierId = payload['supplierId']?.toString() ?? payload['supplier_id']?.toString();
      if (supplierId != null && supplierId.isNotEmpty) {
        pendingSupplierIds.add(supplierId);
      }
      if (opType == 'SUPPLIER_CREATE') {
        final id = payload['id']?.toString() ?? clientOpId;
        if (id.isNotEmpty) pendingSupplierIds.add(id);
      }

      final invoiceId =
          payload['purchaseInvoiceId']?.toString() ??
          payload['purchase_invoice_id']?.toString() ??
          (opType == 'PURCHASE' ? payload['id']?.toString() : null);
      if (invoiceId != null && invoiceId.isNotEmpty) {
        pendingInvoiceIds.add(invoiceId);
      }
      if (opType == 'PURCHASE' && clientOpId.isNotEmpty) {
        pendingInvoiceIds.add(clientOpId);
      }
    }

    final unsyncedSuppliers = await db.query(
      'suppliers',
      columns: ['id'],
      where: 'synced = 0',
    );
    for (final row in unsyncedSuppliers) {
      final id = row['id']?.toString();
      if (id != null) pendingSupplierIds.add(id);
    }

    final unsyncedInvoices = await db.query(
      'purchase_invoices',
      columns: ['id', 'client_op_id', 'supplier_id'],
      where: 'synced = 0',
    );
    for (final row in unsyncedInvoices) {
      final id = row['id']?.toString();
      final cId = row['client_op_id']?.toString();
      final sId = row['supplier_id']?.toString();
      if (id != null) pendingInvoiceIds.add(id);
      if (cId != null) pendingInvoiceIds.add(cId);
      if (sId != null) pendingSupplierIds.add(sId);
    }

    final existingItemsMap = <String, Map<String, dynamic>>{};
    if (pendingItemIds.isNotEmpty) {
      final existingItems = await db.query('items');
      for (final row in existingItems) {
        final id = row['id']?.toString();
        if (id != null) existingItemsMap[id] = row;
      }
    }

    final existingInvoicesMap = <String, Map<String, dynamic>>{};
    if (updates['purchases'] is List) {
      final existingInvoices = await db.query('purchase_invoices');
      for (final row in existingInvoices) {
        final id = row['id']?.toString();
        if (id != null) existingInvoicesMap[id] = row;
      }
    }

    final batch = db.batch();

    // 1) تحديث الأصناف (مع الحفاظ على الكمية المحلية للأصناف التي لديها عمليات معلقة)
    if (updates['items'] is List) {
      final items = updates['items'] as List;
      for (final raw in items) {
        final item = raw is Map<String, dynamic> ? raw : Map<String, dynamic>.from(raw as Map);
        final id = item['id']?.toString();
        if (id == null) continue;

        final existingLocal = existingItemsMap[id];
        final hasPendingItemOp = pendingItemIds.contains(id) && existingLocal != null;
        final resolvedQuantity = hasPendingItemOp
            ? ((existingLocal['quantity'] as num?)?.toDouble() ?? 0.0)
            : ((item['quantity'] as num?)?.toDouble() ?? 0.0);

        batch.insert(
          'items',
          {
            'id': id,
            'name': item['name']?.toString() ?? '',
            'unit': item['unit']?.toString() ?? 'حبة',
            'quantity': resolvedQuantity,
            'sell_price': (item['sell_price'] as num?)?.toDouble() ?? 0.0,
            'cost_price': (item['cost_price'] as num?)?.toDouble(),
            'emergency_price_mode': item['emergency_price_mode']?.toString(),
            'emergency_price_min': (item['emergency_price_min'] as num?)?.toDouble(),
            'emergency_price_max': (item['emergency_price_max'] as num?)?.toDouble(),
            'deleted_at': null,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    }

    // 2) تحديث الموردين (مع عدم الكتابة فوق الموردين غير المتزامنين محلياً)
    if (updates['suppliers'] is List) {
      final suppliers = updates['suppliers'] as List;
      for (final raw in suppliers) {
        final s = raw is Map<String, dynamic> ? raw : Map<String, dynamic>.from(raw as Map);
        final id = s['id']?.toString();
        if (id == null) continue;
        if (pendingSupplierIds.contains(id)) continue;

        batch.insert(
          'suppliers',
          {
            'id': id,
            'name': s['name']?.toString() ?? '',
            'phone': s['phone']?.toString(),
            'current_balance': (s['current_balance'] as num?)?.toDouble() ?? 0.0,
            'status': s['status']?.toString() ?? 'ACTIVE',
            'synced': 1,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    }

    // 3) تحديث فواتير المشتريات (server_updates.purchases) مع عدم الكتابة فوق الفواتير المحلية المعلقة
    if (updates['purchases'] is List) {
      final purchases = updates['purchases'] as List;
      for (final raw in purchases) {
        final p = raw is Map<String, dynamic> ? raw : Map<String, dynamic>.from(raw as Map);
        final id = p['id']?.toString();
        if (id == null) continue;
        if (pendingInvoiceIds.contains(id)) continue;

        final existingInv = existingInvoicesMap[id];
        if (existingInv != null && (existingInv['synced'] as int? ?? 1) == 0) {
          continue;
        }

        final supplierMap = p['supplier'] is Map
            ? Map<String, dynamic>.from(p['supplier'] as Map)
            : null;
        final supplierId =
            p['supplier_id']?.toString() ??
            supplierMap?['id']?.toString() ??
            existingInv?['supplier_id']?.toString() ??
            '';
        final supplierName =
            p['supplier_name']?.toString() ??
            supplierMap?['name']?.toString() ??
            existingInv?['supplier_name']?.toString() ??
            'مورد';

        final totalAmount = (p['total_amount'] as num?)?.toDouble() ?? 0.0;
        final subtotal =
            (p['subtotal'] as num?)?.toDouble() ??
            (existingInv?['subtotal'] as num?)?.toDouble() ??
            totalAmount;
        final taxAmount =
            (p['tax_amount'] as num?)?.toDouble() ??
            (existingInv?['tax_amount'] as num?)?.toDouble() ??
            0.0;
        final discountAmount =
            (p['discount_amount'] as num?)?.toDouble() ??
            (existingInv?['discount_amount'] as num?)?.toDouble() ??
            0.0;
        final paidAmount = (p['paid_amount'] as num?)?.toDouble() ?? 0.0;
        final remainingAmount = (p['remaining_amount'] as num?)?.toDouble() ?? 0.0;

        batch.insert(
          'purchase_invoices',
          {
            'id': id,
            'client_op_id': existingInv?['client_op_id']?.toString() ?? p['client_op_id']?.toString(),
            'invoice_number':
                p['invoice_number']?.toString() ??
                existingInv?['invoice_number']?.toString() ??
                'INV-$id',
            'supplier_invoice_ref':
                p['supplier_invoice_ref']?.toString() ?? existingInv?['supplier_invoice_ref']?.toString(),
            'supplier_id': supplierId,
            'supplier_name': supplierName,
            'invoice_date':
                p['invoice_date']?.toString() ??
                existingInv?['invoice_date']?.toString() ??
                DateTime.now().toIso8601String(),
            'due_date': p['due_date']?.toString() ?? existingInv?['due_date']?.toString(),
            'payment_type':
                p['payment_type']?.toString() ?? existingInv?['payment_type']?.toString() ?? 'CASH',
            'wallet_id': p['wallet_id']?.toString() ?? existingInv?['wallet_id']?.toString(),
            'subtotal': subtotal,
            'tax_amount': taxAmount,
            'discount_amount': discountAmount,
            'total_amount': totalAmount,
            'paid_amount': paidAmount,
            'remaining_amount': remainingAmount,
            'currency': p['currency']?.toString() ?? existingInv?['currency']?.toString() ?? 'YER',
            'status': p['status']?.toString() ?? existingInv?['status']?.toString() ?? 'POSTED',
            'costing_method_used':
                p['costing_method_used']?.toString() ??
                existingInv?['costing_method_used']?.toString() ??
                'WEIGHTED_AVERAGE',
            'attachment_url': p['attachment_url']?.toString() ?? existingInv?['attachment_url']?.toString(),
            'notes': p['notes']?.toString() ?? existingInv?['notes']?.toString(),
            'synced': 1,
            'created_at':
                p['created_at']?.toString() ??
                p['updated_at']?.toString() ??
                existingInv?['created_at']?.toString() ??
                DateTime.now().toIso8601String(),
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );

        if (p['items'] is List) {
          for (final rawLine in (p['items'] as List)) {
            final line = rawLine is Map<String, dynamic>
                ? rawLine
                : Map<String, dynamic>.from(rawLine as Map);
            final lineId = line['id']?.toString();
            if (lineId == null) continue;
            batch.insert(
              'purchase_items',
              {
                'id': lineId,
                'purchase_invoice_id': id,
                'item_id': line['item_id']?.toString() ?? line['itemId']?.toString(),
                'item_name': line['item_name']?.toString() ?? line['itemName']?.toString() ?? '',
                'base_unit': line['base_unit']?.toString() ?? line['baseUnit']?.toString() ?? 'حبة',
                'unit': line['unit']?.toString() ?? 'حبة',
                'conversion_factor':
                    (line['conversion_factor'] as num?)?.toDouble() ??
                    (line['conversionFactor'] as num?)?.toDouble() ??
                    1.0,
                'quantity': (line['quantity'] as num?)?.toDouble() ?? 0.0,
                'base_quantity':
                    (line['base_quantity'] as num?)?.toDouble() ??
                    (line['baseQuantity'] as num?)?.toDouble() ??
                    (line['quantity'] as num?)?.toDouble() ??
                    0.0,
                'unit_cost_price':
                    (line['unit_cost_price'] as num?)?.toDouble() ??
                    (line['unitCostPrice'] as num?)?.toDouble() ??
                    0.0,
                'tax_amount':
                    (line['tax_amount'] as num?)?.toDouble() ??
                    (line['taxAmount'] as num?)?.toDouble() ??
                    0.0,
                'discount_amount':
                    (line['discount_amount'] as num?)?.toDouble() ??
                    (line['discountAmount'] as num?)?.toDouble() ??
                    0.0,
                'total_line_cost':
                    (line['total_line_cost'] as num?)?.toDouble() ??
                    (line['totalLineCost'] as num?)?.toDouble() ??
                    0.0,
                'sell_price':
                    (line['sell_price'] as num?)?.toDouble() ??
                    (line['sellPrice'] as num?)?.toDouble() ??
                    0.0,
                'returned_quantity':
                    (line['returned_quantity'] as num?)?.toDouble() ??
                    (line['returnedQuantity'] as num?)?.toDouble() ??
                    0.0,
              },
              conflictAlgorithm: ConflictAlgorithm.replace,
            );
          }
        }
      }
    }

    // 4) تحديث العمال (server_updates.workers)
    if (updates['workers'] is List) {
      final workers = updates['workers'] as List;
      batch.insert(
        'store_settings',
        {
          'key': 'workers',
          'value': jsonEncode(workers),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    // 5) تحديث إعدادات المتجر
    if (updates['store_settings'] is Map) {
      final settings = updates['store_settings'] as Map;
      for (final entry in settings.entries) {
        batch.insert(
          'store_settings',
          {
            'key': entry.key.toString(),
            'value': entry.value?.toString() ?? '',
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    }

    // 6) تحديث أرصدة عملاء الآجل المعتمدة من الخادم
    final creditCustomersList = updates['credit_customers'] ?? updates['creditCustomers'];
    if (creditCustomersList is List) {
      for (final raw in creditCustomersList) {
        final c = raw is Map<String, dynamic> ? raw : Map<String, dynamic>.from(raw as Map);
        final id = c['id']?.toString();
        if (id == null) continue;
        batch.insert(
          'credit_customers',
          {
            'id': id,
            'name': c['name']?.toString() ?? '',
            'phone': c['phone']?.toString(),
            'credit_limit': (c['credit_limit'] as num?)?.toDouble() ?? (c['creditLimit'] as num?)?.toDouble(),
            'total_debt': (c['current_debt'] as num?)?.toDouble() ??
                (c['currentDebt'] as num?)?.toDouble() ??
                (c['total_debt'] as num?)?.toDouble() ??
                (c['totalDebt'] as num?)?.toDouble() ??
                0.0,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    }

    // 7) تحديث الاشتراك
    if (updates['subscription'] is Map) {
      final sub = updates['subscription'] as Map;
      if (sub['status'] != null) {
        batch.insert(
          'store_settings',
          {'key': 'subscription_status', 'value': sub['status'].toString()},
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    }

    await batch.commit(noResult: true);
  }
}
