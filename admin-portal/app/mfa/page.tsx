'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';

// شاشة هيكلية فقط — التحقق بخطوتين يُربط بعد اعتماد عقده.
export default function MfaPage() {
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');

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
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice('التحقق بخطوتين غير مفعّل بعد على الخادم. لن يُرسل أي رمز.');
        }}
      >
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
          />
        </div>

        <button className="btn-primary w-full" type="submit" disabled={code.length !== 6}>
          تحقق
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
