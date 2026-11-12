'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

type StoreOwnerItem = {
  id: string;
  fullName?: string;
  full_name?: string;
  storeName?: string;
  store_name?: string;
  phone: string;
  status: string;
  counts?: {
    workers?: number;
    devices?: number;
    sales?: number;
  };
  workers_count?: number;
  maxWorkersAllowed?: number;
  max_workers_allowed?: number;
  createdAt?: string;
  created_at?: string;
};

type AuditLogItem = {
  id: string;
  actorType?: string;
  actor_type?: string;
  actionType?: string;
  action?: string;
  targetType?: string;
  target_type?: string;
  createdAt?: string;
  created_at?: string;
};

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [totalOwners, setTotalOwners] = useState(0);
  const [activeOwners, setActiveOwners] = useState(0);
  const [totalDevices, setTotalDevices] = useState(0);
  const [activeBroadcasts, setActiveBroadcasts] = useState(0);
  const [recentOwners, setRecentOwners] = useState<StoreOwnerItem[]>([]);
  const [recentLogs, setRecentLogs] = useState<AuditLogItem[]>([]);

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const [ownersRes, activeRes, devicesRes, broadcastsRes, auditRes] = await Promise.all([
        apiFetch<{ total: number; items: StoreOwnerItem[] }>('/admin/store-owners?limit=5'),
        apiFetch<{ total: number }>('/admin/store-owners?status=ACTIVE&limit=1'),
        apiFetch<{ total: number }>('/admin/devices?limit=1'),
        apiFetch<{ total: number }>('/admin/broadcasts?isActive=true&limit=1'),
        apiFetch<{ total: number; items: AuditLogItem[] }>('/admin/audit-log?limit=6'),
      ]);

      setTotalOwners(ownersRes.total ?? 0);
      setActiveOwners(activeRes.total ?? 0);
      setTotalDevices(devicesRes.total ?? 0);
      setActiveBroadcasts(broadcastsRes.total ?? 0);
      setRecentOwners(ownersRes.items ?? []);
      setRecentLogs(auditRes.items ?? []);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('تعذّر جلب إحصائيات المنصة من الخادم.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const stats = [
    { label: 'مالكو المتاجر', value: loading ? '...' : String(totalOwners), hint: 'إجمالي المتاجر المسجلة', href: '/store-owners' },
    { label: 'الاشتراكات النشطة', value: loading ? '...' : String(activeOwners), hint: 'حسابات المتاجر بالحالة ACTIVE', href: '/subscriptions' },
    { label: 'الأجهزة المسجلة', value: loading ? '...' : String(totalDevices), hint: 'إجمالي بصمات الأجهزة المرتبطة', href: '/devices' },
    { label: 'الإشعارات النشطة', value: loading ? '...' : String(activeBroadcasts), hint: 'الإعلانات والتنبيهات المفعلة حالياً', href: '/broadcasts' },
  ];

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-accent">نظرة عامة</p>
          <h1 className="text-2xl text-brand-900 md:text-3xl">لوحة التحكم</h1>
          <p className="mt-1 text-sm text-muted">
            مؤشرات حية مباشرة من خادم المنصة لإدارة المتاجر والاشتراكات والأجهزة.
          </p>
        </div>
        <button
          type="button"
          onClick={loadDashboard}
          disabled={loading}
          className="rounded-full border border-brand-900/15 bg-white px-4 py-1.5 text-xs font-bold text-brand-800 transition hover:bg-brand-50 disabled:opacity-50"
        >
          {loading ? 'جارٍ التحديث...' : 'تحديث البيانات'}
        </button>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="ملخص سريع">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="card transition hover:border-brand-700/40">
            <p className="text-xs font-semibold text-muted">{stat.label}</p>
            <p className="mt-3 font-display text-3xl text-brand-900">{stat.value}</p>
            <p className="mt-1 text-[11px] text-muted/80">{stat.hint}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <article className="card">
          <div className="flex items-center justify-between">
            <h2 className="text-lg text-brand-900">أحدث المتاجر المسجلة</h2>
            <Link href="/store-owners" className="text-xs font-bold text-brand-700 hover:underline">
              عرض الكل
            </Link>
          </div>

          {recentOwners.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              {loading ? 'جارٍ التحميل...' : 'لا توجد متاجر مسجلة حتى الآن.'}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-brand-900/10 text-xs text-muted">
                    <th className="pb-2">المتجر</th>
                    <th className="pb-2">المالك</th>
                    <th className="pb-2">الهاتف</th>
                    <th className="pb-2">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-900/5">
                  {recentOwners.map((owner) => (
                    <tr key={owner.id}>
                      <td className="py-2.5 font-semibold text-brand-900">{owner.storeName ?? owner.store_name}</td>
                      <td className="py-2.5 text-muted">{owner.fullName ?? owner.full_name}</td>
                      <td className="py-2.5 font-mono text-xs">{owner.phone}</td>
                      <td className="py-2.5">
                        <span className="rounded-full bg-brand-900/5 px-2.5 py-0.5 text-xs font-semibold text-brand-800">
                          {owner.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="card">
          <h2 className="text-lg text-brand-900">سجل التدقيق الأخير</h2>
          {recentLogs.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              {loading ? 'جارٍ التحميل...' : 'لا توجد سجلات تدقيق حديثة.'}
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5 text-sm">
              {recentLogs.map((log) => {
                const action = log.actionType ?? log.action ?? 'إجراء غير محدد';
                const actor = log.actorType ?? log.actor_type ?? 'SYSTEM';
                const target = log.targetType ?? log.target_type;
                const dateStr = log.createdAt ?? log.created_at;
                return (
                  <li
                    key={log.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-cream/60 px-3 py-2 text-xs"
                  >
                    <div>
                      <p className="font-bold text-brand-900">{action}</p>
                      <p className="text-[11px] text-muted">
                        {actor} {target ? `· ${target}` : ''}
                      </p>
                    </div>
                    <span className="text-[11px] text-muted">
                      {dateStr ? new Date(dateStr).toLocaleDateString('ar-YE') : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </section>
    </div>
  );
}
