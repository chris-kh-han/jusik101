'use client';

import Link from 'next/link';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className='flex flex-1 flex-col items-center justify-center px-4 py-16'>
      <h1 className='text-2xl font-bold'>오류가 발생했습니다</h1>
      <p className='text-muted-foreground mt-2'>
        재무제표 데이터를 불러오는 중 문제가 발생했습니다.
      </p>
      <div className='mt-6 flex gap-3'>
        <button
          onClick={reset}
          className='bg-primary text-primary-foreground rounded-full px-6 py-2 text-sm hover:opacity-90'
        >
          다시 시도
        </button>
        <Link
          href='/'
          className='border-border hover:bg-muted rounded-full border px-6 py-2 text-sm'
        >
          홈으로
        </Link>
      </div>
    </div>
  );
}
