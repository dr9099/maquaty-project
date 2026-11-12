import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStatusGuard } from '../dist/common/account-status.guard.js';

function createMockContext({ user, fingerprint = 'DEV-TEST-12345' }) {
  const req = {
    user,
    headers: {
      'x-device-fingerprint': fingerprint,
    },
  };
  return {
    getRequest: () => req,
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  };
}

test('AccountStatusGuard Unit & Cache Invalidation Test Suite', async (t) => {
  let dbQueries = {
    device: 0,
    worker: 0,
    storeOwner: 0,
  };

  let mockPrisma;
  let guard;

  t.beforeEach(() => {
    AccountStatusGuard.clearAllCache();
    dbQueries = { device: 0, worker: 0, storeOwner: 0 };

    mockPrisma = {
      device: {
        findUnique: async ({ where }) => {
          dbQueries.device++;
          if (where.deviceFingerprint === 'DEV-NOT-FOUND') return null;
          if (where.deviceFingerprint === 'DEV-BLOCKED-01') return { status: 'BLOCKED' };
          return { status: 'ACTIVE' };
        },
      },
      worker: {
        findUnique: async ({ where }) => {
          dbQueries.worker++;
          if (where.id === 'w-deleted') return { status: 'DELETED', isResponsible: false, storeOwnerId: 'owner-1' };
          if (where.id === 'w-suspended') return { status: 'SUSPENDED', isResponsible: false, storeOwnerId: 'owner-1' };
          return { status: 'ACTIVE', isResponsible: true, storeOwnerId: 'owner-1' };
        },
      },
      storeOwner: {
        findUnique: async ({ where }) => {
          dbQueries.storeOwner++;
          if (where.id === 'owner-suspended') return { status: 'SUSPENDED', allowResponsiblePurchases: true };
          if (where.id === 'owner-expired') return { status: 'EXPIRED', allowResponsiblePurchases: true };
          return { status: 'ACTIVE', allowResponsiblePurchases: true };
        },
      },
    };

    guard = new AccountStatusGuard(mockPrisma);
  });

  await t.test('1. الجهاز غير المسجل (!dev) لا يُخزن في الكاش ويُستعلم من DB في كل مرة حتى يُسجل', async () => {
    const ctx = createMockContext({
      user: { role: 'STORE_OWNER', storeOwnerId: 'owner-1' },
      fingerprint: 'DEV-NOT-FOUND',
    });

    await assert.rejects(() => guard.canActivate(ctx), {
      message: /هذا الجهاز غير مسجل أو محظور/,
    });
    assert.equal(dbQueries.device, 1);

    // الطلب الثاني يجب أن يستعلم DB مجدداً لأن !dev لا يُخزن
    await assert.rejects(() => guard.canActivate(ctx), {
      message: /هذا الجهاز غير مسجل أو محظور/,
    });
    assert.equal(dbQueries.device, 2);
  });

  await t.test('2. كاش الجهاز الفعال: استعلام واحد فقط ثم قراءة من الذاكرة 0ms', async () => {
    const ctx = createMockContext({
      user: { role: 'STORE_OWNER', storeOwnerId: 'owner-1' },
      fingerprint: 'DEV-ACTIVE-001',
    });

    const res1 = await guard.canActivate(ctx);
    assert.equal(res1, true);
    assert.equal(dbQueries.device, 1);
    assert.equal(dbQueries.storeOwner, 1);

    // الطلب الثاني بنفس الجهاز والمتجر: 0 استعلامات DB!
    const res2 = await guard.canActivate(ctx);
    assert.equal(res2, true);
    assert.equal(dbQueries.device, 1, 'لم يتغير عداد استعلام الجهاز (تمت القراءة من الكاش)');
    assert.equal(dbQueries.storeOwner, 1, 'لم يتغير عداد استعلام المتجر (تمت القراءة من الكاش)');
  });

  await t.test('3. إبطال كاش الجهاز invalidateDevice يجبر على إعادة الاستعلام', async () => {
    const ctx = createMockContext({
      user: { role: 'STORE_OWNER', storeOwnerId: 'owner-1' },
      fingerprint: 'DEV-ACTIVE-002',
    });

    await guard.canActivate(ctx);
    assert.equal(dbQueries.device, 1);

    // إبطال كاش هذا الجهاز
    AccountStatusGuard.invalidateDevice('DEV-ACTIVE-002');

    // الطلب التالي يجب أن يستعلم DB من جديد
    await guard.canActivate(ctx);
    assert.equal(dbQueries.device, 2, 'تم استعلام قاعدة البيانات مجدداً بعد إبطال كاش الجهاز');
  });

  await t.test('4. إبطال كاش المتجر invalidateOwner يوقف فوراً كلاً من المالك وعماله', async () => {
    const ownerCtx = createMockContext({
      user: { role: 'STORE_OWNER', storeOwnerId: 'owner-dynamic' },
      fingerprint: 'DEV-OWNER-01',
    });
    const workerCtx = createMockContext({
      user: { role: 'WORKER', workerId: 'w-active-1', storeOwnerId: 'owner-dynamic' },
      fingerprint: 'DEV-WORKER-01',
    });

    // ضبط استجابة العامل ليرجع نفس المتجر owner-dynamic
    mockPrisma.worker.findUnique = async () => {
      dbQueries.worker++;
      return { status: 'ACTIVE', isResponsible: true, storeOwnerId: 'owner-dynamic' };
    };

    // ضبط استجابة المالك لتكون ACTIVE في البداية
    let currentOwnerStatus = 'ACTIVE';
    mockPrisma.storeOwner.findUnique = async () => {
      dbQueries.storeOwner++;
      return { status: currentOwnerStatus, allowResponsiblePurchases: true };
    };

    // الطلب الأول للمالك: يستعلم storeOwner مرة واحدة
    await guard.canActivate(ownerCtx);
    assert.equal(dbQueries.storeOwner, 1, 'تم استعلام المالك مرة أولى');

    // الطلب الأول للعامل: يقرأ المالك من الكاش دون استعلام إضافي لـ storeOwner!
    await guard.canActivate(workerCtx);
    assert.equal(dbQueries.storeOwner, 1, 'تمت قراءة كاش المالك للعامل دون استعلام إضافي');

    // تغيير حالة المتجر في DB إلى SUSPENDED واستدعاء إبطال كاش المتجر
    currentOwnerStatus = 'SUSPENDED';
    AccountStatusGuard.invalidateOwner('owner-dynamic');

    // فحص المالك: يجب أن يرفض فوراً بـ 423
    await assert.rejects(() => guard.canActivate(ownerCtx), {
      message: /تم إيقاف حسابك مؤقتاً/,
    });

    // فحص العامل: يجب أن يرفض فوراً بـ 423 لنفس سبب إيقاف المتجر الأب
    await assert.rejects(() => guard.canActivate(workerCtx), {
      message: /تم إيقاف حسابك مؤقتاً/,
    });
  });

  await t.test('5. إبطال كاش العامل invalidateWorker يجبر الحارس على قراءة بيانات العامل المحدثة', async () => {
    let workerStatus = 'ACTIVE';
    mockPrisma.worker.findUnique = async () => {
      dbQueries.worker++;
      return { status: workerStatus, isResponsible: true, storeOwnerId: 'owner-1' };
    };

    const workerCtx = createMockContext({
      user: { role: 'WORKER', workerId: 'w-dyn', storeOwnerId: 'owner-1' },
      fingerprint: 'DEV-W-DYN',
    });

    await guard.canActivate(workerCtx);
    assert.equal(dbQueries.worker, 1);

    // الطلب الثاني بدون إبطال: كاش
    await guard.canActivate(workerCtx);
    assert.equal(dbQueries.worker, 1);

    // إيقاف العامل واستدعاء invalidateWorker
    workerStatus = 'SUSPENDED';
    AccountStatusGuard.invalidateWorker('w-dyn');

    // الطلب الثالث: يجب أن يستعلم DB ويرفض العامل الموقوف
    await assert.rejects(() => guard.canActivate(workerCtx), {
      message: /الحساب موقوف مؤقتاً/,
    });
    assert.equal(dbQueries.worker, 2);
  });
});
