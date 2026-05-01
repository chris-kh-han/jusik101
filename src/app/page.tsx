import { SearchBar } from '@/components/search/SearchBar';
import { PopularCompanies } from '@/components/search/PopularCompanies';

// Cloudflare Pages 호환: Edge Runtime + 동적 렌더링
// (PopularCompanies가 D1을 조회하므로 런타임에 렌더링 필요)
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <div className='flex flex-1 flex-col items-center justify-center px-4 py-16'>
      <div className='flex flex-col items-center gap-8'>
        <div className='text-center'>
          <h1 className='text-4xl font-bold tracking-tight sm:text-5xl'>
            주식101
          </h1>
          <p className='text-muted-foreground mt-3 text-lg'>
            재무제표, 이제 쉽게 읽어보세요 ㅁㄴㅇㄹ
          </p>
        </div>

        <SearchBar />

        <PopularCompanies />
      </div>
    </div>
  );
}
