'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

type BroadcastItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: string;
  targetType?: string;
  target_type?: string;
  targetDeviceId?: string;
  target_device_id?: string;
  isActive?: boolean;
  is_active?: boolean;
  createdAt?: string;
  created_at?: string;
};

export default function BroadcastsPage() {
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState('POPUP');
  const [priority, setPriority] = useState('NORMAL');
  const [targetType, setTargetType] = useState('ALL');
  const [targetDeviceId, setTargetDeviceId] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchBroadcasts = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ items: BroadcastItem[] }>('/admin/broadcasts?limit=50');
      setBroadcasts(res.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر جلب الإشعارات.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBroadcasts();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');
    if (!title.trim() || !body.trim()) return;

    try {
      await apiFetch('/admin/broadcasts', {
        method: 'POST',
        body: {
          type,
          title: title.trim(),
          body: body.trim(),
          priority,
          targetType,
          ...(targetType === 'SPECIFIC_DEVICE' && targetDeviceId.trim()
            ? { targetDeviceId: targetDeviceId.trim() }
            : {}),
          isActive: true,
        },
      });
      setTitle('');
      setBody('');
      setTargetDeviceId('');
      setMessage('تم نشر الإشعار بنجاح.');
      await fetchBroadcasts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل إنشاء الإشعار.');
    }
  };

  const handleToggleActive = async (item: BroadcastItem) => {
    setMessage('');
    setError('');
    const currentlyActive = item.isActive ?? item.is_active ?? true;
    try {
      await apiFetch(`/admin/broadcasts/${item.id}`, {
        method: 'PATCH',
        body: { isActive: !currentlyActive },
      });
      await fetchBroadcasts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل تحديث حالة الإشعار.');
    }
  };

  const handleDelete = async (item: BroadcastItem) => {
    setMessage('');
    setError('');
    if (!stepUpCode.trim()) {
      setError('يرجى إدخال رمز التحقق بخطوتين (Step-Up MFA) لحذف الإشعار.');
      return;
    }
    try {
      await apiFetch(`/admin/broadcasts/${item.id}`, {
        method: 'DELETE',
        stepUpCode: stepUpCode.trim(),
      });
      setMessage('تم حذف الإشعار بنجاح.');
      await fetchBroadcasts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل حذف الإشعار.');
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-bold text-accent">التواصل مع المتاجر</p>
        <h1 className="text-2xl text-brand-900 md:text-3xl">الإشعارات والتعميمات</h1>
        <p className="mt-1 text-sm text-muted">
          إرسال تنبيهات وتعميمات فورية لتطبيقات المتاجر عند المزامنة.
        </p>
      </section>

      {message ? (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-red-500/10 px-4 py-2 text-xs font-bold text-red-700">
          {error}
        </p>
      ) : null}

      <section className="card">
        <h2 className="text-lg text-brand-900">إنشاء إشعار جديد</h2>
        <form className="mt-4 space-y-3" onSubmit={handleCreate}>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="field-label" htmlFor="b-type">
                نوع الإشعار
              </label>
              <select
                id="b-type"
                className="field-input"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="POPUP">نافذة منبثقة (POPUP)</option>
                <option value="NOTIFICATION">إشعار نظام (NOTIFICATION)</option>
                <option value="OFFER">عرض خاص (OFFER)</option>
                <option value="ADVERTISEMENT">إعلان ترويجي (ADVERTISEMENT)</option>
                <option value="STICKY_BANNER">شريط علوي مثبت (STICKY_BANNER)</option>
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="b-priority">
                الأولوية
              </label>
              <select
                id="b-priority"
                className="field-input"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="NORMAL">عادية (NORMAL)</option>
                <option value="HIGH">عالية (HIGH)</option>
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="b-target">
                الجمهور المستهدف
              </label>
              <select
                id="b-target"
                className="field-input"
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
              >
                <option value="ALL">جميع الأجهزة (ALL)</option>
                <option value="TRIAL">المتاجر التجريبية (TRIAL)</option>
                <option value="ACTIVE">المتاجر النشطة (ACTIVE)</option>
                <option value="EXPIRED">الاشتراكات المنتهية (EXPIRED)</option>
                <option value="SPECIFIC_DEVICE">جهاز محدد (SPECIFIC_DEVICE)</option>
              </select>
            </div>
          </div>

          {targetType === 'SPECIFIC_DEVICE' ? (
            <div>
              <label className="field-label" htmlFor="b-target-device">
                معرف الجهاز المستهدف (UUID)
              </label>
              <input
                id="b-target-device"
                type="text"
                className="field-input font-mono text-xs"
                placeholder="مثال: c853d9e8-7822-4467-b5f6-6218d6e3f5eb"
                value={targetDeviceId}
                onChange={(e) => setTargetDeviceId(e.target.value)}
                required
              />
            </div>
          ) : null}

          <div>
            <label className="field-label" htmlFor="b-title">
              عنوان الإشعار
            </label>
            <input
              id="b-title"
              type="text"
              className="field-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="field-label" htmlFor="b-body">
              نص الإشعار
            </label>
            <textarea
              id="b-body"
              rows={3}
              className="field-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary">
            نشر الإشعار
          </button>
        </form>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg text-brand-900">الإشعارات المسجلة ({broadcasts.length})</h2>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            className="field-input max-w-[180px] text-xs tracking-widest"
            placeholder="رمز MFA للحذف"
            value={stepUpCode}
            onChange={(e) => setStepUpCode(e.target.value)}
          />
        </div>

        {broadcasts.length === 0 ? (
          <p className="text-sm text-muted">
            {loading ? 'جارٍ التحميل...' : 'لا توجد إشعارات مسجلة.'}
          </p>
        ) : (
          <div className="space-y-2.5">
            {broadcasts.map((b) => {
              const active = b.isActive ?? b.is_active ?? true;
              const target = b.targetType ?? b.target_type ?? 'ALL';
              return (
                <div
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-900/10 bg-cream/40 p-3.5"
                >
                  <div>
                    <p className="font-bold text-brand-900">
                      {b.title}{' '}
                      <span className="rounded bg-brand-900/5 px-2 py-0.5 text-[10px] font-bold text-brand-800">
                        {b.type}
                      </span>
                      <span className="mr-1 rounded bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                        {target}
                      </span>
                      <span className="mr-1 rounded bg-brand-700/10 px-2 py-0.5 text-[10px] text-brand-700">
                        {b.priority}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted">{b.body}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(b)}
                      className="rounded-lg border border-brand-900/15 px-2.5 py-1 text-xs font-semibold"
                    >
                      {active ? 'إيقاف' : 'تفعيل'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(b)}
                      className="rounded-lg border border-red-600/30 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                      حذف
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

