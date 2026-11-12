'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { apiFetch, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice('');
    setLoading(true);

    try {
      const res = await apiFetch<{
        mfa_required: boolean;
        mfa_challenge_token: string;
        mfa_enrollment?: {
          secret: string;
          otpauth_url: string;
        };
      }>('/auth/admin/login', {
        method: 'POST',
        body: { phone: phone.trim(), password },
      });

      if (res.mfa_challenge_token) {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('maquaty_admin_mfa_challenge_token', res.mfa_challenge_token);
          if (res.mfa_enrollment) {
            window.sessionStorage.setItem(
              'maquaty_admin_mfa_enrollment',
              JSON.stringify(res.mfa_enrollment)
            );
          } else {
            window.sessionStorage.removeItem('maquaty_admin_mfa_enrollment');
          }
        }
        router.push('/mfa');
      } else {
        setNotice('فشل الحصول على رمز التحقق بخطوتين من الخادم.');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setNotice(err.message);
      } else {
        setNotice('تعذّر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="تسجيل الدخول"
      subtitle="دخول مالك المنصة (Platform Admin) فقط."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link className="font-semibold text-brand-700 hover:underline" href="/set-new-password">
            تعيين كلمة مرور جديدة
          </Link>
          <Link className="font-semibold text-brand-700 hover:underline" href="/mfa">
            التحقق بخطوتين
          </Link>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="field-label" htmlFor="phone">
            رقم الهاتف
          </label>
          <input
            className="field-input"
            id="phone"
            name="phone"
            type="tel"
            autoComplete="username"
            placeholder="777000000"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
            disabled={loading}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="password">
            كلمة المرور
          </label>
          <input
            className="field-input"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={loading}
          />
        </div>

        <button className="btn-primary w-full" type="submit" disabled={loading}>
          {loading ? 'جارٍ التحقق...' : 'متابعة'}
        </button>

        {notice ? (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700" role="status">
            {notice}
          </p>
        ) : null}
      </form>
    </AuthShell>
  );
}
