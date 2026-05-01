import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { findCompanyByCode } from '@/lib/company-search';
import {
  findCompanyByCodeD1,
  findCompanyByStockCodeD1,
} from '@/lib/company-search-d1';
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

/**
 * 회사 정보 조회 (다단계 fallback으로 데이터 품질 이슈 자동 보정)
 *
 * 우선순위:
 *   1. D1: corp_code 직접 조회
 *   2. 정적 JSON: corp_code 조회 → stock_code 추출 → D1 stock_code로 재조회
 *      (예전 corp_code로 들어와도 D1의 정확한 corp_code로 자동 매핑)
 *   3. 정적 JSON 그대로 반환 (D1 없을 때만)
 */
async function lookupCompany(corpCode: string) {
  // 1. D1 직접 조회
  try {
    const fromD1 = await findCompanyByCodeD1(corpCode);
    if (fromD1) return fromD1;
  } catch (error) {
    if (!(error instanceof D1Error)) throw error;
  }

  // 2. 정적 JSON에서 corp_code → stock_code 매핑, D1에서 stock_code로 재조회
  //    (companies.json에 잘못된 corp_code가 있어도 정확한 D1 데이터로 보정)
  const staticHit = findCompanyByCode(corpCode);
  if (staticHit?.stockCode) {
    try {
      const correctedFromD1 = await findCompanyByStockCodeD1(
        staticHit.stockCode,
      );
      if (correctedFromD1) return correctedFromD1;
    } catch (error) {
      if (!(error instanceof D1Error)) throw error;
    }
  }

  // 3. D1 사용 불가 시 정적 JSON으로 마무리 fallback
  return staticHit ?? null;
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
    console.error('[CompanyPage] financial fetch error:', e);
    if (e instanceof DartApiError && e.code === '013') {
      error = '해당 기업의 재무제표 데이터가 없습니다.';
    } else if (e instanceof Error && e.message.includes('DART_API_KEY')) {
      error =
        'DART API 키가 설정되지 않았습니다. .env.local 파일에 DART_API_KEY를 설정해주세요.';
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      error = `재무제표 데이터를 불러오는 중 오류가 발생했습니다: ${msg}`;
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
