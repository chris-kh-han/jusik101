import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { findCompanyByCode } from '@/lib/company-search';
import {
  findCompanyByCodeD1,
  findCompanyByStockCodeD1,
} from '@/lib/company-search-d1';
import { D1Error, getD1 } from '@/lib/d1-client';
import { HealthScoreCard } from '@/components/dashboard/HealthScoreCard';
import { KeyMetricsBar } from '@/components/dashboard/KeyMetricsBar';
import { DashboardCharts } from '@/components/dashboard/DashboardCharts';
import { CompanyHeaderSection } from '@/components/dashboard/CompanyHeaderSection';
import { InvestmentMetricsCards } from '@/components/dashboard/InvestmentMetricsCards';
import { StabilityMetricsCards } from '@/components/dashboard/StabilityMetricsCards';
import { QuarterlyBarLineChart } from '@/components/charts/QuarterlyBarLineChart';
import { QuarterlyStabilityChart } from '@/components/charts/QuarterlyStabilityChart';
import { getLatestReportYear } from '@/lib/cache';
import { normalizeFinancialData, groupByStatement } from '@/lib/data-transform';
import { calculateRatios, getHealthScore } from '@/lib/financial-utils';
import {
  loadCompanyPageData,
  extractMetricsFromIndices,
  extractDividendData,
  calculateBPS,
  calculateValuationRatios,
} from '@/lib/company-data-loader';
import { buildQuarterlySeries } from '@/lib/quarterly-utils';
import type { D1Database } from '@cloudflare/workers-types';
import { findCompaniesByStockCodesD1 } from '@/lib/company-search-d1';

// Cloudflare Pages 호환: Edge Runtime 명시
export const runtime = 'edge';

interface PageProps {
  params: Promise<{ code: string }>;
}

/** D1 binding 안전하게 가져오기 (없으면 null) */
async function getD1Optional(): Promise<D1Database | null> {
  try {
    return await getD1();
  } catch (error) {
    if (error instanceof D1Error) return null;
    throw error;
  }
}

/**
 * 회사 정보 조회 (다단계 fallback으로 데이터 품질 이슈 자동 보정)
 */
async function lookupCompany(corpCode: string) {
  try {
    const fromD1 = await findCompanyByCodeD1(corpCode);
    if (fromD1) return fromD1;
  } catch (error) {
    if (!(error instanceof D1Error)) throw error;
  }

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

  return staticHit ?? null;
}

/** D1에서 marketCap 조회 (가능하면 D1 row 자체에 있음) */
async function lookupMarketCap(stockCode: string): Promise<number | null> {
  try {
    const rows = await findCompaniesByStockCodesD1([stockCode]);
    // SearchResult 타입에는 market_cap이 없어서 별도 query 필요
    // 일단 정적 JSON fallback에 marketCap이 있으면 사용
    if (rows.length === 0) return null;
    return null; // 추후 d1-client 직접 사용으로 보완
  } catch {
    return null;
  }
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
    description: `${company.corpName}의 재무제표, 투자 지표, 분기별 추세를 한눈에. PER, ROE, 부채비율 등 종합 분석.`,
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
  const db = await getD1Optional();

  // 정적 JSON에서 marketCap (예전 dump에 들어 있음)
  const staticEntry = findCompanyByCode(company.corpCode);
  const marketCap =
    (staticEntry as { marketCap?: number | null } | null | undefined)
      ?.marketCap ?? (await lookupMarketCap(company.stockCode));

  // 모든 데이터 병렬 로드 (D1 캐시 → DART)
  let pageData: Awaited<ReturnType<typeof loadCompanyPageData>> | null = null;
  let loadError: string | null = null;

  try {
    pageData = await loadCompanyPageData(db, company.corpCode, year, 'CFS');
  } catch (e) {
    console.error('[CompanyPage] data load error:', e);
    loadError =
      e instanceof Error ? e.message : '재무 데이터를 불러올 수 없습니다.';
  }

  // 분기 시계열 + 메트릭 추출
  const quarterly = pageData
    ? buildQuarterlySeries(pageData.quarterlyReports, 12)
    : [];
  const indexMetrics = pageData
    ? extractMetricsFromIndices(pageData.indices)
    : null;
  const dividendData = pageData ? extractDividendData(pageData.dividend) : null;

  // 가장 최근 사업보고서 (가장 큰 연도) — find는 가장 오래된 거 반환할 수 있어 명시적으로 sort
  const annualReportForRatios = pageData?.quarterlyReports
    .filter((r) => r.reportCode === '11011')
    .sort((a, b) => b.year - a.year)[0];
  const findAmount = (accountName: string, sjDiv: string) => {
    const raw = annualReportForRatios?.items.find(
      (it) => it.account_nm === accountName && it.sj_div === sjDiv,
    )?.thstrm_amount;
    if (!raw) return null;
    const n = Number(raw.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const totalEquityNum = findAmount('자본총계', 'BS');
  const netIncomeNum = findAmount('당기순이익', 'IS');
  const revenueNum = findAmount('매출액', 'IS');

  const bps = calculateBPS(
    dividendData?.estimatedShares ?? null,
    totalEquityNum,
  );

  // PER/PBR/PSR — 시가총액 / 재무 데이터 (시총이 있을 때만 유효)
  const valuation = calculateValuationRatios(
    marketCap,
    netIncomeNum,
    totalEquityNum,
    revenueNum,
  );

  // 사업보고서 기반 기존 카드 데이터 (HealthScore, KeyMetrics, DashboardCharts)
  const annualReport = pageData?.quarterlyReports.find(
    (r) => r.year === year && r.reportCode === '11011',
  );
  const annualNormalized = annualReport
    ? normalizeFinancialData(annualReport.items)
    : [];
  const grouped =
    annualNormalized.length > 0 ? groupByStatement(annualNormalized) : null;
  const ratios =
    annualNormalized.length > 0 ? calculateRatios(annualNormalized) : null;
  const healthScore = ratios ? getHealthScore(ratios) : null;

  // 인사이트 한 줄
  const latestQuarter = quarterly[quarterly.length - 1];
  const prevQuarter = quarterly[quarterly.length - 2];
  const netIncomeQoQ =
    latestQuarter?.netIncome && prevQuarter?.netIncome && prevQuarter.netIncome
      ? ((latestQuarter.netIncome - prevQuarter.netIncome) /
          Math.abs(prevQuarter.netIncome)) *
        100
      : null;
  const opQoQ =
    latestQuarter?.operatingProfit &&
    prevQuarter?.operatingProfit &&
    prevQuarter.operatingProfit
      ? ((latestQuarter.operatingProfit - prevQuarter.operatingProfit) /
          Math.abs(prevQuarter.operatingProfit)) *
        100
      : null;

  return (
    <div className='mx-auto max-w-5xl px-4 py-6'>
      <Link
        href='/'
        className='text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm'
      >
        <ArrowLeft className='h-4 w-4' />
        홈으로
      </Link>

      <div className='space-y-6'>
        {/* 1. 헤더 */}
        <CompanyHeaderSection
          company={{
            corpName: company.corpName,
            stockCode: company.stockCode,
            listedMarket: company.listedMarket,
            marketCap,
            ceoName: pageData?.companyInfo?.ceo_nm ?? null,
            homepage: pageData?.companyInfo?.hm_url ?? null,
            establishedDate: pageData?.companyInfo?.est_dt ?? null,
            settlementMonth: pageData?.companyInfo?.acc_mt ?? null,
            bizNo: pageData?.companyInfo?.bizr_no ?? null,
          }}
          fiscalYearLabel={`${year}년 사업보고서 기준`}
        />

        {loadError && (
          <div className='rounded-xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900 dark:bg-amber-950'>
            <p className='text-amber-800 dark:text-amber-200'>{loadError}</p>
          </div>
        )}

        {/* 2. 투자 지표 */}
        {indexMetrics && dividendData && (
          <InvestmentMetricsCards
            metrics={{
              roe: indexMetrics.investment.roe,
              eps: dividendData.current.eps,
              bps: bps,
              dividendYield: dividendData.current.dividendYield,
              dividendPerShare: dividendData.current.dividendPerShare,
              payoutRatio: dividendData.current.payoutRatio,
              per: valuation.per,
              pbr: valuation.pbr,
              psr: valuation.psr,
            }}
            dividendHistory={dividendData.history}
          />
        )}

        {/* 3. 안정성 지표 카드 */}
        {indexMetrics && (
          <StabilityMetricsCards
            metrics={{
              debtRatio: indexMetrics.stability.debtRatio,
              currentRatio: indexMetrics.stability.currentRatio,
              interestCoverage: null, // 별도 계산 필요
            }}
          />
        )}

        {/* 4. 수익성 차트 (분기별) */}
        {quarterly.length > 0 && (
          <QuarterlyBarLineChart
            title='수익성'
            subtitle='매출·순이익 성장률'
            description={
              netIncomeQoQ !== null
                ? `${latestQuarter.label} ${company.corpName}의 순이익은 직전 분기 대비 ${netIncomeQoQ >= 0 ? '+' : ''}${netIncomeQoQ.toFixed(1)}% ${netIncomeQoQ >= 0 ? '높아요' : '낮아요'}.`
                : undefined
            }
            quarters={quarterly}
            primaryBar={{ field: 'revenue', label: '매출', color: '#1e40af' }}
            secondaryBar={{
              field: 'netIncome',
              label: '순이익',
              color: '#93c5fd',
            }}
            rateLine={{
              field: 'netMargin',
              label: '순이익률',
              color: '#eab308',
            }}
          />
        )}

        {/* 5. 성장성 차트 (영업이익) */}
        {quarterly.length > 0 && (
          <QuarterlyBarLineChart
            title='성장성'
            subtitle='영업이익 성장률'
            description={
              opQoQ !== null
                ? `${latestQuarter.label} ${company.corpName}의 영업이익은 직전 분기 대비 ${opQoQ >= 0 ? '+' : ''}${opQoQ.toFixed(1)}% ${opQoQ >= 0 ? '높아요' : '낮아요'}.`
                : undefined
            }
            quarters={quarterly}
            primaryBar={{
              field: 'operatingProfit',
              label: '영업이익',
              color: '#7c3aed',
            }}
            rateLine={{
              field: 'operatingMargin',
              label: '영업이익률',
              color: '#10b981',
            }}
          />
        )}

        {/* 6. 안정성 차트 (총자본/총부채/부채비율) */}
        {quarterly.length > 0 && (
          <QuarterlyStabilityChart quarters={quarterly} />
        )}

        {/* 7. 종합 평가 (기존 컴포넌트 재사용) */}
        {healthScore && (
          <section>
            <h2 className='mb-3 text-xl font-bold'>종합 평가</h2>
            <HealthScoreCard healthScore={healthScore} />
          </section>
        )}

        {/* 8. 보조: 주요 지표 + 재무제표 차트 (기존) */}
        {annualNormalized.length > 0 && (
          <section>
            <h2 className='mb-3 text-xl font-bold'>주요 지표</h2>
            <KeyMetricsBar items={annualNormalized} />
          </section>
        )}

        {grouped && (
          <section>
            <h2 className='mb-3 text-xl font-bold'>재무제표</h2>
            <DashboardCharts statements={grouped} />
          </section>
        )}
      </div>
    </div>
  );
}
