'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';

// شاشة هيكلية فقط — لا تُرسل بيانات حقيقية حتى تُعتمد عقود /admin/auth.
export default function LoginPage() {
  const [notice, setNotice] = useState('');

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
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice('الشاشة جاهزة، لكن نقطة الدخول الإدارية لم تُعتمد بعد. لن يُرسل أي شيء.');
        }}
      >
        <div>
          <label className="field-label" htmlFor="email">
            البريد الإلكتروني
          </label>
          <input
            className="field-input"
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="admin@maqouti.app"
            required
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
            required
          />
        </div>

        <button className="btn-primary w-full" type="submit">
          متابعة
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
