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
    final path = p.join(dbPath, 'muqawati_${storeOwnerId}.db');

    final db = await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await _createTables(db);
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
