'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

type DeviceItem = {
  id: string;
  deviceFingerprint?: string;
  device_fingerprint?: string;
  deviceName?: string;
  device_name?: string;
  platform?: string;
  appVersion?: string;
  app_version?: string;
  os?: string;
  status: 'ACTIVE' | 'BLOCKED';
  lastSeenAt?: string;
  last_seen_at?: string;
  storeOwner?: {
    id: string;
    storeName?: string;
    store_name?: string;
    phone: string;
  };
  store_owner?: {
    id: string;
    storeName?: string;
    store_name?: string;
    phone: string;
  };
};

export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchDevices = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);

      const res = await apiFetch<{ total: number; items: DeviceItem[] }>(
        `/admin/devices?${params.toString()}`
      );
      setDevices(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر جلب قائمة الأجهزة.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, [statusFilter]);

  const handleToggleBlock = async (device: DeviceItem) => {
    setMessage('');
    setError('');
    if (!stepUpCode.trim()) {
      setError('يرجى إدخال رمز التحقق بخطوتين (Step-Up MFA) لتنفيذ حظر أو فك حظر الجهاز.');
      return;
    }
    const action = device.status === 'BLOCKED' ? 'unblock' : 'block';
    try {
      await apiFetch(`/admin/devices/${device.id}/${action}`, {
        method: 'PATCH',
        stepUpCode: stepUpCode.trim(),
      });
      setMessage(
        action === 'block'
          ? 'تم حظر الجهاز وإبطال جلساته بنجاح.'
          : 'تم رفع الحظر عن الجهاز بنجاح.'
      );
      await fetchDevices();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل تحديث حالة الجهاز.');
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-bold text-accent">أمن الأجهزة</p>
        <h1 className="text-2xl text-brand-900 md:text-3xl">الأجهزة المسجلة ({total})</h1>
        <p className="mt-1 text-sm text-muted">
          مراقبة بصمات الأجهزة المرتبطة بالمتاجر وحظر الأجهزة المشبوهة فوراً.
        </p>
      </section>

      <section className="card space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="device-search">
              بحث بالبصمة أو اسم الجهاز
            </label>
            <input
              id="device-search"
              type="text"
              className="field-input"
              placeholder="بصمة الجهاز..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="device-status">
              الحالة
            </label>
            <select
              id="device-status"
              className="field-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">الكل</option>
              <option value="ACTIVE">نشط (ACTIVE)</option>
              <option value="BLOCKED">محظور (BLOCKED)</option>
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="device-stepup">
              رمز التحقق (Step-Up MFA)
            </label>
            <input
              id="device-stepup"
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
              onClick={fetchDevices}
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
      </section>

      <section className="card overflow-x-auto">
        {devices.length === 0 ? (
          <p className="text-sm text-muted">
            {loading ? 'جارٍ التحميل...' : 'لا توجد أجهزة مسجلة مطابقة.'}
          </p>
        ) : (
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b border-brand-900/10 text-xs text-muted">
                <th className="pb-3">بصمة الجهاز</th>
                <th className="pb-3">المتجر</th>
                <th className="pb-3">الإصدار</th>
                <th className="pb-3">الحالة</th>
                <th className="pb-3">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-900/5">
              {devices.map((d) => {
                const fingerprint = d.deviceFingerprint ?? d.device_fingerprint ?? '—';
                const owner = d.storeOwner ?? d.store_owner;
                const storeName = owner ? (owner.storeName ?? owner.store_name ?? '—') : null;
                const ownerText = storeName ? `${storeName} (${owner?.phone ?? ''})` : '—';
                const appVer = d.appVersion ?? d.app_version ?? '—';
                return (
                  <tr key={d.id}>
                    <td className="py-3 font-mono text-xs text-brand-900">
                      {fingerprint}
                    </td>
                    <td className="py-3 text-xs">
                      {ownerText}
                    </td>
                    <td className="py-3 text-xs text-muted">{appVer}</td>
                    <td className="py-3">
                      <span className="rounded-full bg-brand-900/5 px-2.5 py-0.5 text-xs font-bold">
                        {d.status}
                      </span>
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => handleToggleBlock(d)}
                        className="rounded-lg border border-red-600/30 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        {d.status === 'BLOCKED' ? 'فك الحظر' : 'حظر الجهاز'}
                      </button>
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

