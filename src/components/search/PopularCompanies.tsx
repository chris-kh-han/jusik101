import Link from 'next/link';
import { getPopularCompanies } from '@/lib/company-search';
import { getPopularCompaniesD1 } from '@/lib/popular-companies';
import { D1Error } from '@/lib/d1-client';

export async function PopularCompanies() {
  // D1 우선, 실패 시 정적 JSON 인기 기업으로 fallback
  let companies;
  try {
    companies = await getPopularCompaniesD1();
    if (companies.length === 0) {
      // D1은 가용하지만 데이터 없음 (아직 sync 전 등) → fallback
      companies = getPopularCompanies();
    }
  } catch (error) {
    if (error instanceof D1Error) {
      companies = getPopularCompanies();
    } else {
      throw error;
    }
  }

  return (
    <div className='w-full max-w-2xl'>
      <h2 className='text-muted-foreground mb-4 text-center text-sm font-medium'>
        인기 기업
      </h2>
      <div className='flex flex-wrap justify-center gap-2'>
        {companies.map((company) => (
          <Link
            key={company.corpCode}
            href={`/company/${company.corpCode}`}
            className='border-border bg-card hover:bg-accent hover:text-accent-foreground rounded-full border px-4 py-2 text-sm transition-colors'
          >
            {company.corpName}
          </Link>
        ))}
      </div>
    </div>
  );
}
