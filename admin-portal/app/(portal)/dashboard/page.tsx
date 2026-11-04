const stats = [
  { label: 'مالكو المتاجر', value: '—', hint: 'بانتظار ربط العقد' },
  { label: 'الاشتراكات النشطة', value: '—', hint: 'بانتظار ربط العقد' },
  { label: 'الأجهزة المسجلة', value: '—', hint: 'بانتظار ربط العقد' },
  { label: 'طلبات بانتظار المراجعة', value: '—', hint: 'بانتظار ربط العقد' },
];

const pending = [
  'Step-up MFA لعمليات مالك المنصة',
  'عقد PATCH /admin/subscriptions/{id}',
  'مرساة التجديد وإغلاق الصفوف',
  'إعادة تفعيل حساب موقوف',
  'تخفيض max_workers_allowed',
  'إنهاء الاشتراك تلقائياً',
  'فرض حظر الجهاز عند الدخول',
  'قائمة مفاتيح system_settings',
  'Rate Limiting للبوابة',
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-accent">نظرة عامة</p>
          <h1 className="text-2xl text-brand-900 md:text-3xl">لوحة التحكم</h1>
          <p className="mt-1 text-sm text-muted">
            هذه الشاشة هيكلية. ستُعبَّأ الأرقام بعد اعتماد عقود <code>/admin/*</code>.
          </p>
        </div>
        <span className="rounded-full border border-brand-900/10 bg-white px-3 py-1.5 text-[11px] text-muted">
          لا توجد بيانات حقيقية معروضة
        </span>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="ملخص سريع">
        {stats.map((stat) => (
          <article key={stat.label} className="card">
            <p className="text-xs font-semibold text-muted">{stat.label}</p>
            <p className="mt-3 font-display text-3xl text-brand-900">{stat.value}</p>
            <p className="mt-1 text-[11px] text-muted/80">{stat.hint}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <article className="card">
          <h2 className="text-lg text-brand-900">حالة التكامل</h2>
          <p className="mt-1 text-sm text-muted">
            الشاشات التالية تحتاج قرارات وعقوداً قبل التنفيذ الفعلي، ولا تُبنى افتراضات مكانها.
          </p>

          <div className="mt-4 rounded-xl border border-dashed border-brand-900/20 bg-cream/60 p-4">
            <p className="text-sm font-semibold text-brand-900">جاهز الآن</p>
            <ul className="mt-2 space-y-1.5 text-sm text-muted">
              <li>هيكل Next.js + TypeScript + Tailwind (RTL)</li>
              <li>تخطيط البوابة والقائمة الجانبية</li>
              <li>شاشات الدخول والتحقق وكلمة المرور (هيكلية)</li>
              <li>عميل API موحّد على <code>/v1</code></li>
            </ul>
          </div>
        </article>

        <article className="card">
          <h2 className="text-lg text-brand-900">قرارات مفتوحة</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {pending.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-amber-500"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  );
}
