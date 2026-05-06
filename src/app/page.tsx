import { SearchBar } from '@/components/search/SearchBar';
import { CompanyListSection } from '@/components/home/CompanyListSection';

// Cloudflare Pages 호환: Edge Runtime + 동적 렌더링
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <div className='mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-4 py-10'>
      <div className='flex w-full flex-col items-center gap-8'>
        <div className='text-center'>
          <h1 className='text-4xl font-bold tracking-tight sm:text-5xl'>
            주식101
          </h1>
          <p className='text-muted-foreground mt-3 text-lg'>
            재무제표, 이제 쉽게 읽어보세요
          </p>
        </div>

        <SearchBar />

        <CompanyListSection />
      </div>
    </div>
  );
}
