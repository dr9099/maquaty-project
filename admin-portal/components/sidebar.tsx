'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = {
  href: string;
  label: string;
  enabled: boolean;
  hint?: string;
};

const items: NavItem[] = [
  { href: '/dashboard', label: 'لوحة التحكم', enabled: true },
  { href: '/store-owners', label: 'مالكو المتاجر', enabled: true },
  { href: '/subscriptions', label: 'الاشتراكات', enabled: true },
  { href: '/devices', label: 'الأجهزة', enabled: true },
  { href: '/broadcasts', label: 'الإشعارات', enabled: true },
  { href: '/settings', label: 'إعدادات النظام', enabled: true },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden border-e border-brand-900/10 bg-white md:flex md:min-h-screen md:flex-col">
      <div className="flex items-center gap-3 border-b border-brand-900/10 px-5 py-5">
        <img
          src="/Logo.png"
          alt="شعار مَقوتي"
          className="h-11 w-11 rounded-xl object-cover shadow-md shadow-brand-900/15 border border-secondary/30"
        />
        <div className="leading-tight">
          <p className="font-display text-lg text-brand-900">مَقوتي</p>
          <p className="text-[11px] text-muted">بوابة مالك المنصة</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3" aria-label="أقسام البوابة">
        {items.map((item) => {
          const active = item.enabled && pathname === item.href;
          const base =
            'flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition';

          if (!item.enabled) {
            return (
              <span
                key={item.href}
                className={`${base} cursor-not-allowed text-muted/50`}
                aria-disabled="true"
              >
                <span>{item.label}</span>
                <span className="rounded-full bg-brand-900/5 px-2 py-0.5 text-[10px] font-normal">
                  {item.hint}
                </span>
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${base} ${
                active
                  ? 'bg-brand-700 text-white shadow-md shadow-brand-900/20'
                  : 'text-brand-900 hover:bg-brand-50'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-brand-900/10 p-4">
        <p className="text-[11px] leading-relaxed text-muted">
          جميع مسارات <code className="rounded bg-brand-900/5 px-1">/v1/admin/*</code> متصلة ومحمية.
        </p>
      </div>
    </aside>
  );
}
