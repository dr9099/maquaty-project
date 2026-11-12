'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { apiFetch, ApiError, authToken } from '@/lib/api';

export default function SetNewPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= 8 && password === confirm && !loading;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice('');
    setLoading(true);

    try {
      const tokenToUse =
        tempToken.trim() ||
        (typeof window !== 'undefined'
          ? window.sessionStorage.getItem('maquaty_temp_access_token')
          : null) ||
        authToken.get();

      const res = await apiFetch<{
        access_token?: string;
        refresh_token?: string;
      }>('/auth/set-new-password', {
        method: 'POST',
        token: tokenToUse,
        body: {
          newPassword: password,
          newPasswordConfirmation: confirm,
        },
      });

      if (res.access_token) {
        authToken.setTokens(res.access_token, res.refresh_token);
      }
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem('maquaty_temp_access_token');
      }
      setNotice('تم تعيين كلمة المرور الجديدة بنجاح.');
      router.push('/login');
    } catch (err) {
      if (err instanceof ApiError) {
        setNotice(err.message);
      } else {
        setNotice('تعذّر تعيين كلمة المرور الجديدة. تحقق من صلاحية التوكن المؤقت.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="تعيين كلمة مرور جديدة"
      subtitle="استخدم كلمة المرور المؤقتة مرة واحدة ثم عيّن كلمة مرور دائمة قوية."
      footer={
        <Link className="font-semibold text-brand-700 hover:underline" href="/login">
          العودة إلى تسجيل الدخول
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="field-label" htmlFor="temp-token">
            رمز الجلسة المؤقت (اختياري إن كنت مسجلاً للتو)
          </label>
          <input
            className="field-input"
            id="temp-token"
            name="temp-token"
            type="text"
            placeholder="Bearer token..."
            value={tempToken}
            onChange={(event) => setTempToken(event.target.value)}
            disabled={loading}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="new-password">
            كلمة المرور الجديدة
          </label>
          <input
            className="field-input"
            id="new-password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={loading}
          />
          {tooShort ? <p className="mt-1 text-xs text-red-600">8 أحرف على الأقل.</p> : null}
        </div>

        <div>
          <label className="field-label" htmlFor="confirm-password">
            تأكيد كلمة المرور
          </label>
          <input
            className="field-input"
            id="confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
            disabled={loading}
          />
          {mismatch ? <p className="mt-1 text-xs text-red-600">كلمتا المرور غير متطابقتين.</p> : null}
        </div>

        <button className="btn-primary w-full" type="submit" disabled={!canSubmit}>
          {loading ? 'جارٍ الحفظ...' : 'حفظ'}
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
