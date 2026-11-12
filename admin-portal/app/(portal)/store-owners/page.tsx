'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

type StoreOwner = {
  id: string;
  fullName?: string;
  full_name?: string;
  storeName?: string;
  store_name?: string;
  phone: string;
  status: 'TRIAL' | 'TRIAL_WARNING' | 'TRIAL_EXPIRED' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  trialSalesUsed?: number;
  trial_sales_used?: number;
  trialSalesLimit?: number;
  trial_sales_limit?: number;
  counts?: {
    workers?: number;
    devices?: number;
    sales?: number;
  };
  workers_count?: number;
  maxWorkersAllowed?: number;
  max_workers_allowed?: number;
  currency?: string;
  createdAt?: string;
  created_at?: string;
  activeSubscription?: {
    id: string;
    planName: string;
    startsAt: string;
    expiresAt: string;
    status: string;
  } | null;
};

export default function StoreOwnersPage() {
  const [owners, setOwners] = useState<StoreOwner[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [phoneFilter, setPhoneFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [tempPassResult, setTempPassResult] = useState<{
    phone: string;
    tempPassword: string;
    expiresAt: string;
  } | null>(null);

  const fetchOwners = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (phoneFilter.trim()) params.set('phone', phoneFilter.trim());
      if (statusFilter) params.set('status', statusFilter);

      const res = await apiFetch<{ total: number; items: StoreOwner[] }>(
        `/admin/store-owners?${params.toString()}`
      );
      setOwners(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر جلب قائمة المتاجر.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOwners();
  }, [statusFilter]);

  const handleToggleStatus = async (owner: StoreOwner) => {
    setMessage('');
    setError('');
    if (!stepUpCode.trim()) {
      setError('يرجى إدخال رمز التحقق بخطوتين (Step-Up MFA) في الحقل العلوي لتنفيذ الإجراء الحساس.');
      return;
    }
    const targetStatus = owner.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    const storeDisplayName = owner.storeName ?? owner.store_name ?? owner.phone;
    try {
      await apiFetch(`/admin/store-owners/${owner.id}/status`, {
        method: 'PATCH',
        stepUpCode: stepUpCode.trim(),
        body: {
          status: targetStatus,
          reason: targetStatus === 'SUSPENDED' ? 'إيقاف إداري من بوابة المنصة' : 'إعادة تفعيل الحساب',
        },
      });
      setMessage(`تم تحديث حالة متجر "${storeDisplayName}" إلى ${targetStatus}.`);
      await fetchOwners();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل تحديث حالة المتجر.');
    }
  };

  const handleUpdateWorkerLimit = async (owner: StoreOwner) => {
    const storeDisplayName = owner.storeName ?? owner.store_name ?? owner.phone;
    const currentLimit = owner.maxWorkersAllowed ?? owner.max_workers_allowed ?? 0;
    const nextStr = window.prompt(
      `أدخل الحد الأقصى المسموح به للعمال في متجر "${storeDisplayName}":`,
      String(currentLimit)
    );
    if (nextStr === null) return;
    const maxWorkersAllowed = Number.parseInt(nextStr, 10);
    if (Number.isNaN(maxWorkersAllowed) || maxWorkersAllowed < 0) return;

    setMessage('');
    setError('');
    try {
      await apiFetch(`/admin/store-owners/${owner.id}/worker-limit`, {
        method: 'PATCH',
        body: { maxWorkersAllowed },
      });
      setMessage(`تم تحديث سقف العمال لمتجر "${storeDisplayName}" إلى ${maxWorkersAllowed}.`);
      await fetchOwners();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل تحديث حد العمال.');
    }
  };

  const handleGenerateTempPassword = async (owner: StoreOwner) => {
    setMessage('');
    setError('');
    setTempPassResult(null);
    if (!stepUpCode.trim()) {
      setError('يرجى إدخال رمز التحقق بخطوتين (Step-Up MFA) في الحقل العلوي لتوليد كلمة مرور مؤقتة.');
      return;
    }
    try {
      const res = await apiFetch<{
        tempPassword?: string;
        temp_password?: string;
        expiresAt?: string;
        expires_at?: string;
      }>(`/admin/store-owners/${owner.id}/generate-temp-password`, {
        method: 'POST',
        stepUpCode: stepUpCode.trim(),
      });
      const generatedPass = res.tempPassword ?? res.temp_password ?? '';
      const expDate = res.expiresAt ?? res.expires_at ?? '';
      setTempPassResult({
        phone: owner.phone,
        tempPassword: generatedPass,
        expiresAt: expDate,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل توليد كلمة المرور المؤقتة.');
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-accent">إدارة الحسابات</p>
          <h1 className="text-2xl text-brand-900 md:text-3xl">مالكو المتاجر ({total})</h1>
          <p className="mt-1 text-sm text-muted">
            البحث، تفعيل أو إيقاف المتاجر، تعديل سقف العمال، وتوليد كلمات المرور المؤقتة.
          </p>
        </div>
      </section>

      <section className="card space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="search-phone">
              بحث برقم الهاتف
            </label>
            <input
              id="search-phone"
              type="text"
              className="field-input"
              placeholder="مثال: 77"
              value={phoneFilter}
              onChange={(e) => setPhoneFilter(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="status-filter">
              تصفية حسب الحالة
            </label>
            <select
              id="status-filter"
              className="field-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">الكل</option>
              <option value="TRIAL">تجريبي (TRIAL)</option>
              <option value="ACTIVE">نشط (ACTIVE)</option>
              <option value="EXPIRED">منتهي (EXPIRED)</option>
              <option value="SUSPENDED">موقوف (SUSPENDED)</option>
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="step-up-code">
              رمز التحقق (Step-Up MFA) للعمليات الحساسة
            </label>
            <input
              id="step-up-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="field-input tracking-widest"
              placeholder="000000"
              value={stepUpCode}
              onChange={(e) => setStepUpCode(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={fetchOwners}
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? 'جارٍ البحث...' : 'تحديث / بحث'}
            </button>
          </div>
        </div>

        {message ? (
          <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-800">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-700">
            {error}
          </p>
        ) : null}
        {tempPassResult ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <p className="font-bold text-brand-900">
              كلمة المرور المؤقتة للحساب ({tempPassResult.phone}):
            </p>
            <p className="mt-1 font-mono text-lg font-bold text-accent">
              {tempPassResult.tempPassword}
            </p>
            <p className="mt-1 text-xs text-muted">
              تنتهي الصلاحية في: {new Date(tempPassResult.expiresAt).toLocaleString('ar-YE')}
            </p>
          </div>
        ) : null}
      </section>

      <section className="card overflow-x-auto">
        {owners.length === 0 ? (
          <p className="text-sm text-muted">
            {loading ? 'جارٍ التحميل...' : 'لا توجد متاجر مطابقة للبحث.'}
          </p>
        ) : (
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-brand-900/10 text-xs text-muted">
                <th className="pb-3">المتجر</th>
                <th className="pb-3">المالك</th>
                <th className="pb-3">الهاتف</th>
                <th className="pb-3">الحالة</th>
                <th className="pb-3">العمال</th>
                <th className="pb-3">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-900/5">
              {owners.map((owner) => {
                const storeName = owner.storeName ?? owner.store_name ?? '—';
                const fullName = owner.fullName ?? owner.full_name ?? '—';
                const workersCount = owner.counts?.workers ?? owner.workers_count ?? 0;
                const maxWorkers = owner.maxWorkersAllowed ?? owner.max_workers_allowed ?? 0;
                return (
                  <tr key={owner.id}>
                    <td className="py-3 font-bold text-brand-900">{storeName}</td>
                    <td className="py-3 text-muted">{fullName}</td>
                    <td className="py-3 font-mono text-xs">{owner.phone}</td>
                    <td className="py-3">
                      <span className="rounded-full bg-brand-900/5 px-2.5 py-0.5 text-xs font-bold text-brand-800">
                        {owner.status}
                      </span>
                    </td>
                    <td className="py-3 text-xs">
                      {workersCount} / {maxWorkers}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleUpdateWorkerLimit(owner)}
                          className="rounded-lg border border-brand-900/15 px-2.5 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-50"
                        >
                          سقف العمال
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerateTempPassword(owner)}
                          className="rounded-lg border border-amber-600/30 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                        >
                          كلمة مرور مؤقتة
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(owner)}
                          className="rounded-lg border border-red-600/30 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                        >
                          {owner.status === 'SUSPENDED' ? 'إعادة تفعيل' : 'إيقاف الحساب'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

