'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';

// شاشة هيكلية فقط — تُربط بعقد كلمة المرور المؤقتة بعد اعتماده.
export default function SetNewPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [notice, setNotice] = useState('');

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= 8 && password === confirm;

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
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice('نقطة تعيين كلمة المرور غير مفعّلة بعد. لن يُحفظ أي شيء.');
        }}
      >
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
          />
          {mismatch ? <p className="mt-1 text-xs text-red-600">كلمتا المرور غير متطابقتين.</p> : null}
        </div>

        <button className="btn-primary w-full" type="submit" disabled={!canSubmit}>
          حفظ
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
