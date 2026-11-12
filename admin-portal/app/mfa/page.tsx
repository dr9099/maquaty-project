'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { apiFetch, ApiError, authToken } from '@/lib/api';

export default function MfaPage() {
  const router = useRouter();
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = window.sessionStorage.getItem('maquaty_admin_mfa_challenge_token');
    if (!token) {
      setNotice('لا يوجد رمز تحدٍّ سارٍ. يرجى تسجيل الدخول أولاً.');
      return;
    }
    setChallengeToken(token);

    const enrollmentRaw = window.sessionStorage.getItem('maquaty_admin_mfa_enrollment');
    if (enrollmentRaw) {
      try {
        setEnrollment(JSON.parse(enrollmentRaw));
      } catch {
        setEnrollment(null);
      }
    }
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challengeToken) {
      router.push('/login');
      return;
    }

    setNotice('');
    setLoading(true);

    try {
      const res = await apiFetch<{
        role: string;
        access_token: string;
        refresh_token: string;
      }>('/auth/admin/mfa/verify', {
        method: 'POST',
        body: {
          mfaChallengeToken: challengeToken,
          code,
        },
      });

      if (res.access_token) {
        authToken.setTokens(res.access_token, res.refresh_token);
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem('maquaty_admin_mfa_challenge_token');
          window.sessionStorage.removeItem('maquaty_admin_mfa_enrollment');
        }
        router.push('/');
      } else {
        setNotice('فشل استلام توكنات الوصول من الخادم.');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setNotice(err.message);
      } else {
        setNotice('تعذّر الاتصال بالخادم. يرجى المحاولة مجدداً.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="التحقق بخطوتين"
      subtitle="أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة."
      footer={
        <Link className="font-semibold text-brand-700 hover:underline" href="/login">
          العودة إلى تسجيل الدخول
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {enrollment ? (
          <div className="rounded-xl border border-secondary/30 bg-secondary/10 p-3 text-xs text-brand-900 space-y-1">
            <p className="font-bold">إعداد التحقق بخطوتين لأول مرة:</p>
            <p>أدخل المفتاح السري التالي في تطبيق المصادقة (Google Authenticator):</p>
            <code className="block rounded bg-white p-2 font-mono text-center text-sm font-bold tracking-wider select-all border border-brand-900/10">
              {enrollment.secret}
            </code>
          </div>
        ) : null}

        <div>
          <label className="field-label" htmlFor="code">
            رمز التحقق
          </label>
          <input
            className="field-input text-center text-lg tracking-[0.5em]"
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            required
            disabled={loading || !challengeToken}
            autoFocus
          />
        </div>

        <button
          className="btn-primary w-full"
          type="submit"
          disabled={code.length !== 6 || loading || !challengeToken}
        >
          {loading ? 'جارٍ التحقق...' : 'تحقق'}
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
