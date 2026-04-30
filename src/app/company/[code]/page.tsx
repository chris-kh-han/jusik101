import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { findCompanyByCode } from '@/lib/company-search';
import { findCompanyByCodeD1 } from '@/lib/company-search-d1';
import { D1Error } from '@/lib/d1-client';
import { HealthScoreCard } from '@/components/dashboard/HealthScoreCard';
import { KeyMetricsBar } from '@/components/dashboard/KeyMetricsBar';
import { DashboardCharts } from '@/components/dashboard/DashboardCharts';
import { getCachedFinancials, getLatestReportYear } from '@/lib/cache';
import { normalizeFinancialData, groupByStatement } from '@/lib/data-transform';

// Cloudflare Pages 호환: Edge Runtime 명시
export const runtime = 'edge';
import { calculateRatios, getHealthScore } from '@/lib/financial-utils';
import { DartApiError } from '@/lib/dart-api';

/** D1 우선, 실패 시 정적 JSON으로 fallback */
async function lookupCompany(corpCode: string) {
  try {
    const fromD1 = await findCompanyByCodeD1(corpCode);
    if (fromD1) return fromD1;
  } catch (error) {
    if (!(error instanceof D1Error)) throw error;
  }
  return findCompanyByCode(corpCode) ?? null;
}

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { code } = await params;
  const company = await lookupCompany(code);

  if (!company) {
    return { title: '기업을 찾을 수 없습니다' };
  }

  return {
    title: `${company.corpName} (${company.stockCode}) 재무제표`,
    description: `${company.corpName}의 재무제표를 쉽게 분석합니다. 재무 건강 점수, 손익계산서, 재무상태표를 한눈에 확인하세요.`,
  };
}

export const revalidate = 86400; // 24시간

export default async function CompanyPage({ params }: PageProps) {
  const { code } = await params;
  const company = await lookupCompany(code);

  if (!company) {
    notFound();
  }

  const year = getLatestReportYear();

  let financialData = null;
  let error: string | null = null;

  try {
    const rawData = await getCachedFinancials(company.corpCode, year);
    if (rawData.length > 0) {
      const normalized = normalizeFinancialData(rawData);
      const grouped = groupByStatement(normalized);
      const ratios = calculateRatios(normalized);
      const healthScore = getHealthScore(ratios);

      financialData = { normalized, grouped, ratios, healthScore };
    } else {
      error = '해당 연도의 재무제표 데이터가 없습니다.';
    }
  } catch (e) {
    if (e instanceof DartApiError && e.code === '013') {
      error = '해당 기업의 재무제표 데이터가 없습니다.';
    } else if (e instanceof Error && e.message.includes('DART_API_KEY')) {
      error =
        'DART API 키가 설정되지 않았습니다. .env.local 파일에 DART_API_KEY를 설정해주세요.';
    } else {
      error = '재무제표 데이터를 불러오는 중 오류가 발생했습니다.';
    }
  }

  return (
    <div className='mx-auto max-w-5xl px-4 py-8'>
      {/* 헤더 */}
      <div className='mb-8'>
        <Link
          href='/'
          className='text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm'
        >
          <ArrowLeft className='h-4 w-4' />
          홈으로
        </Link>
        <div className='flex items-baseline gap-3'>
          <h1 className='text-3xl font-bold'>{company.corpName}</h1>
          <span className='text-muted-foreground text-lg'>
            {company.stockCode}
          </span>
          <span className='bg-muted rounded-full px-2 py-0.5 text-xs'>
            {company.listedMarket}
          </span>
        </div>
        <p className='text-muted-foreground mt-1 text-sm'>
          {year}년 사업보고서 기준
        </p>
      </div>

      {error && (
        <div className='rounded-xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900 dark:bg-amber-950'>
          <p className='text-amber-800 dark:text-amber-200'>{error}</p>
          <p className='mt-2 text-sm text-amber-600 dark:text-amber-400'>
            OpenDART API 키를 발급받고 .env.local에 설정하면 실제 데이터를 볼 수
            있습니다.
          </p>
        </div>
      )}

      {financialData && (
        <div className='space-y-6'>
          <HealthScoreCard healthScore={financialData.healthScore} />
          <KeyMetricsBar items={financialData.normalized} />
          <DashboardCharts statements={financialData.grouped} />
        </div>
      )}
    </div>
  );
}
