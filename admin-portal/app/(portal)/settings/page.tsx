'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';

type SystemSettingsMap = Record<string, unknown>;

const SETTING_FIELDS: Array<{
  key: string;
  label: string;
  type: 'number' | 'text' | 'select';
  placeholder: string;
  options?: Array<{ value: string; label: string }>;
}> = [
  { key: 'trial_sales_limit', label: 'حد عمليات البيع في الفترة التجريبية', type: 'number', placeholder: '50' },
  { key: 'trial_warning_threshold', label: 'عتبة التنبيه المتبقية في الفترة التجريبية', type: 'number', placeholder: '10' },
  { key: 'backup_retention_days', label: 'عدد أيام الاحتفاظ بالنسخ الاحتياطية', type: 'number', placeholder: '30' },
  { key: 'contact_phone', label: 'رقم هاتف الدعم والتواصل الرسمي', type: 'text', placeholder: '735717710' },
  { key: 'min_app_version', label: 'أدنى إصدار مسموح لتطبيق الأندرويد (min_app_version)', type: 'text', placeholder: '1.0.0' },
  {
    key: 'default_emergency_price_mode',
    label: 'سياسة التسعير الاضطراري الافتراضية',
    type: 'select',
    placeholder: 'RANGE_OR_OPEN',
    options: [
      { value: 'RANGE_OR_OPEN', label: 'نطاق سعري أو مفتوح (RANGE_OR_OPEN)' },
      { value: 'COST_ONLY', label: 'بسعر التكلفة فقط (COST_ONLY)' },
      { value: 'COST_PLUS', label: 'التكلفة + هامش ربح (COST_PLUS)' },
    ],
  },
  { key: 'trial_expired_message', label: 'رسالة انتهاء الفترة التجريبية', type: 'text', placeholder: 'انتهت الفترة التجريبية...' },
  { key: 'subscription_expired_message', label: 'رسالة انتهاء الاشتراك', type: 'text', placeholder: 'انتهى اشتراك المتجر...' },
  { key: 'suspended_message', label: 'رسالة إيقاف الحساب', type: 'text', placeholder: 'تم تعليق حساب المتجر...' },
];

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadSettings = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<SystemSettingsMap>('/admin/settings');
      const next: Record<string, string> = {};
      for (const field of SETTING_FIELDS) {
        const raw = res?.[field.key];
        next[field.key] = raw !== undefined && raw !== null ? String(raw) : '';
      }
      if (!next.min_app_version && res?.app_min_version) {
        next.min_app_version = String(res.app_min_version);
      }
      setValues(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر جلب إعدادات النظام.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const settingsPayload = SETTING_FIELDS.filter(
        (f) => values[f.key] !== undefined && values[f.key].trim() !== ''
      ).map((f) => ({
        key: f.key,
        value: f.type === 'number' ? Number(values[f.key]) : values[f.key].trim(),
      }));

      await apiFetch('/admin/settings', {
        method: 'PATCH',
        body: { settings: settingsPayload },
      });
      setMessage('تم حفظ إعدادات النظام وتحديث الكاش بنجاح ✅');
      await loadSettings();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'فشل حفظ الإعدادات.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-bold text-accent">التحكم المركزي</p>
        <h1 className="text-2xl text-brand-900 md:text-3xl">إعدادات النظام العامة</h1>
        <p className="mt-1 text-sm text-muted">
          تعديل ثوابت المنصة ورسائل القفل ورقم الدعم الفني وحدود الفترة التجريبية ديناميكياً.
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

      <section className="card">
        <form className="space-y-4" onSubmit={handleSave}>
          <div className="grid gap-4 md:grid-cols-2">
            {SETTING_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="field-label" htmlFor={field.key}>
                  {field.label} <code className="text-[10px] text-muted">({field.key})</code>
                </label>
                {field.type === 'select' && field.options ? (
                  <select
                    id={field.key}
                    className="field-input"
                    value={values[field.key] || field.placeholder}
                    onChange={(e) =>
                      setValues((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }))
                    }
                    disabled={loading || saving}
                  >
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={field.key}
                    type={field.type}
                    className="field-input"
                    placeholder={field.placeholder}
                    value={values[field.key] ?? ''}
                    onChange={(e) =>
                      setValues((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }))
                    }
                    disabled={loading || saving}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || saving}
              className="btn-primary"
            >
              {saving ? 'جارٍ الحفظ...' : 'حفظ جميع الإعدادات'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

