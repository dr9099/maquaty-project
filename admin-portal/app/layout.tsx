import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'لوحة إدارة مَقوتي',
  description: 'بوابة مالك المنصة (App Owner) لإدارة اشتراكات ومتاجر مَقوتي.',
  robots: { index: false, follow: false },
  icons: {
    icon: '/Logo.png',
    apple: '/Logo.png',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
