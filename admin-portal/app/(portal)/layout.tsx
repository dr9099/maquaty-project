import { Sidebar } from '@/components/sidebar';
import { LogoutButton } from '@/components/logout-button';

export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-cream md:grid md:grid-cols-[260px_1fr]">
      <Sidebar />

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-brand-900/10 bg-cream/90 backdrop-blur">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4 md:px-8">
            <div className="flex items-center gap-3">
              <img
                src="/Logo.png"
                alt="شعار مَقوتي"
                className="h-9 w-9 rounded-lg object-cover md:hidden border border-secondary/30"
              />
              <div>
                <p className="text-sm font-bold text-brand-900">بوابة مالك المنصة</p>
                <p className="text-[11px] text-muted">إدارة الاشتراكات والمتاجر والأجهزة</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden rounded-full bg-secondary/20 px-3 py-1 text-[11px] font-semibold text-brand-700 sm:inline">
                بوابة الإدارة المركزية
              </span>
              <LogoutButton />
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>

        <footer className="border-t border-brand-900/10 px-4 py-4 text-[11px] text-muted md:px-8">
          مَقوتي — لوحة إدارة داخلية. لا تُعرض بيانات أي متجر للعامة.
        </footer>
      </div>
    </div>
  );
}
