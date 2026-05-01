import Link from 'next/link';

export default function NotFound() {
  return (
    <div className='flex flex-1 flex-col items-center justify-center px-4 py-16'>
      <h1 className='text-4xl font-bold'>404</h1>
      <p className='text-muted-foreground mt-2 text-lg'>
        기업을 찾을 수 없습니다
      </p>
      <Link
        href='/'
        className='bg-primary text-primary-foreground mt-6 rounded-full px-6 py-2 text-sm hover:opacity-90'
      >
        홈으로 돌아가기
      </Link>
    </div>
  );
}
