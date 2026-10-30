import 'dart:convert';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// قاعدة البيانات المحلية SQLite لدعم التشغيل دون اتصال (Offline-first)
/// مع عزل تام لكل متجر في ملف منفصل (R-35)
class AppDatabase {
  static final Map<String, Database> _databases = {};

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

  // إضافة عملية إلى طابور المزامنة غير المتصل
  static Future<void> enqueueOperation(
    Database db, {
    required String clientOpId,
    required String opType,
    required Map<String, dynamic> payload,
  }) async {
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
      conflictAlgorithm: ConflictAlgorithm.replace,
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
}
