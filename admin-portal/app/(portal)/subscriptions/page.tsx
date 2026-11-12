'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

type SubscriptionPlan = {
  id: string;
  name: string;
  durationDays?: number;
  duration_days?: number;
  isCustom?: boolean;
  is_custom?: boolean;
  isActive?: boolean;
  is_active?: boolean;
};

type StoreOwnerItem = {
  id: string;
  fullName?: string;
  full_name?: string;
  storeName?: string;
  store_name?: string;
  phone: string;
  status: string;
  subscription_ends_at?: string | null;
};

export default function SubscriptionsPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [owners, setOwners] = useState<StoreOwnerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [planName, setPlanName] = useState('');
  const [planDays, setPlanDays] = useState('30');
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [agreedAmount, setAgreedAmount] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [plansRes, ownersRes] = await Promise.all([
        apiFetch<SubscriptionPlan[]>('/admin/subscription-plans'),
        apiFetch<{ items: StoreOwnerItem[] }>('/admin/store-owners?limit=100'),
      ]);
      const planList = Array.isArray(plansRes) ? plansRes : [];
      const ownerList = ownersRes.items ?? [];
      setPlans(planList);
      setOwners(ownerList);
      if (planList.length > 0 && !selectedPlanId) {
        setSelectedPlanId(planList[0].id);
      }
      if (ownerList.length > 0 && !selectedOwnerId) {
        setSelectedOwnerId(ownerList[0].id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تحميل خطط الاشتراكات.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');
    const durationDays = Number.parseInt(planDays, 10);
    if (!planName.trim() || Number.isNaN(durationDays) || durationDays < 1) return;

    try {
      await apiFetch('/admin/subscription-plans', {
        method: 'POST',
        body: {
          name: planName.trim(),
          durationDays,
          isActive: true,
        },
      });
      setPlanName('');
      setPlanDays('30');
      setMessage('تمت إضافة خطة الاشتراك بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل إنشاء خطة الاشتراك.');
    }
  };

  const handleAssignSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');
    if (!selectedOwnerId || !selectedPlanId) return;

    try {
      await apiFetch(`/admin/store-owners/${selectedOwnerId}/subscriptions`, {
        method: 'POST',
        body: {
          planId: selectedPlanId,
          ...(agreedAmount.trim() ? { agreedAmount: Number(agreedAmount) } : {}),
        },
      });
      setAgreedAmount('');
      setMessage('تم تفعيل الاشتراك للمتجر بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل تفعيل الاشتراك للمتجر.');
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-bold text-accent">إدارة الباقات والتجديد</p>
        <h1 className="text-2xl text-brand-900 md:text-3xl">الاشتراكات وخطط التفعيل</h1>
        <p className="mt-1 text-sm text-muted">
          إنشاء خطط الاشتراك وتفعيل أو تمديد اشتراكات المتاجر المسجلة.
        </p>
      </section>

      {message ? (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-xs font-bold text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-red-500/10 px-4 py-2.5 text-xs font-bold text-red-700">
          {error}
        </p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="card">
          <h2 className="text-lg text-brand-900">تفعيل اشتراك لمتجر</h2>
          <form className="mt-4 space-y-3" onSubmit={handleAssignSubscription}>
            <div>
              <label className="field-label" htmlFor="owner-select">
                اختيار المتجر
              </label>
              <select
                id="owner-select"
                className="field-input"
                value={selectedOwnerId}
                onChange={(e) => setSelectedOwnerId(e.target.value)}
                required
              >
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.storeName ?? o.store_name} — {o.phone} ({o.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="plan-select">
                خطة الاشتراك
              </label>
              <select
                id="plan-select"
                className="field-input"
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                required
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.durationDays ?? p.duration_days} يوم)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="agreed-amount">
                المبلغ المتفق عليه (اختياري)
              </label>
              <input
                id="agreed-amount"
                type="number"
                className="field-input"
                placeholder="مثال: 10000"
                value={agreedAmount}
                onChange={(e) => setAgreedAmount(e.target.value)}
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full">
              تفعيل الاشتراك الآن
            </button>
          </form>
        </article>

        <article className="card">
          <h2 className="text-lg text-brand-900">إضافة خطة اشتراك جديدة</h2>
          <form className="mt-4 space-y-3" onSubmit={handleCreatePlan}>
            <div>
              <label className="field-label" htmlFor="plan-name">
                اسم الخطة
              </label>
              <input
                id="plan-name"
                type="text"
                className="field-input"
                placeholder="مثال: باقة شهرية"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor="plan-days">
                مدة الاشتراك (بالأيام)
              </label>
              <input
                id="plan-days"
                type="number"
                min={1}
                className="field-input"
                value={planDays}
                onChange={(e) => setPlanDays(e.target.value)}
                required
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full">
              حفظ الخطة الجديدة
            </button>
          </form>
        </article>
      </section>

      <section className="card">
        <h2 className="text-lg text-brand-900">الخطط المتاحة ({plans.length})</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => {
            const days = p.durationDays ?? p.duration_days ?? 0;
            const active = p.isActive ?? p.is_active ?? true;
            return (
              <div
                key={p.id}
                className="rounded-xl border border-brand-900/10 bg-cream/50 p-4"
              >
                <p className="font-bold text-brand-900">{p.name}</p>
                <p className="mt-1 text-xs text-muted">المدة: {days} يوم</p>
                <span className="mt-2 inline-block rounded-full bg-brand-900/5 px-2.5 py-0.5 text-[11px] font-semibold">
                  {active ? 'مفعّلة' : 'غير مفعّلة'}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

