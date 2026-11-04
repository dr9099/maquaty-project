import Link from 'next/link';
import type { ReactNode } from 'react';

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-brand-200/50 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 right-0 h-64 w-64 rounded-full bg-secondary/15 blur-3xl"
      />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <img
            src="/Logo.png"
            alt="شعار مَقوتي"
            className="h-12 w-12 rounded-xl object-cover shadow-lg shadow-brand-900/20 border border-secondary/30"
          />
          <div className="leading-tight">
            <p className="font-display text-xl text-brand-900">مَقوتي</p>
            <p className="text-xs text-muted">بوابة مالك المنصة</p>
          </div>
        </div>

        <section className="card">
          <header className="mb-6">
            <h1 className="text-2xl text-brand-900">{title}</h1>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </header>

          {children}

          {footer ? <div className="mt-6 border-t border-brand-900/10 pt-4 text-sm">{footer}</div> : null}
        </section>

        <p className="mt-5 text-center text-xs text-muted">
          <Link className="font-semibold text-brand-700 hover:underline" href="/dashboard">
            معاينة الواجهة
          </Link>
          <span aria-hidden="true"> · </span>
          <span>هذه البوابة لا تعرض بيانات متجرك العام.</span>
        </p>
      </div>
    </main>
  );
}
