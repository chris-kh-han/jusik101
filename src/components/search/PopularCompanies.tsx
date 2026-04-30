import Link from 'next/link';
import { getPopularCompanies } from '@/lib/company-search';

export function PopularCompanies() {
  const companies = getPopularCompanies();

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
