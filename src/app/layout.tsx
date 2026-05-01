import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Footer } from '@/components/Footer';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: '주식101 - 재무제표를 쉽게',
    template: '%s | 주식101',
  },
  description:
    'DART 재무제표 데이터를 초보자도 쉽게 이해할 수 있도록 시각화하는 서비스입니다.',
  keywords: ['재무제표', 'DART', '주식', '투자', '재무분석', '초보자'],
  openGraph: {
    title: '주식101 - 재무제표를 쉽게',
    description:
      'DART 재무제표 데이터를 초보자도 쉽게 이해할 수 있도록 시각화합니다.',
    type: 'website',
    locale: 'ko_KR',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang='ko'
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className='bg-background text-foreground flex min-h-full flex-col'>
        <main className='flex-1'>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
