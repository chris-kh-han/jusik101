/**
 * 미국 종목 상세 페이지 (`/us/[ticker]`)
 *
 * 한국 `/company/[code]`와 동일한 8개 섹션 구조 — 토스 인베스트 스타일.
 * 데이터 소스만 다름:
 *   - 한국: DART API → financial_cache → company-data-loader
 *   - 미국: SEC EDGAR sync 결과 D1 (us_companies / us_financials_quarterly / us_dividends)
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { D1Error, getD1 } from '@/lib/d1-client';
import { CompanyHeaderSection } from '@/components/dashboard/CompanyHeaderSection';
import { InvestmentMetricsCards } from '@/components/dashboard/InvestmentMetricsCards';
import { StabilityMetricsCards } from '@/components/dashboard/StabilityMetricsCards';
import { loadUsCompanyPageData } from '@/lib/us-data-loader';
import { buildUsQuarterlySeries, calculateTtm } from '@/lib/us-quarterly';
import { buildUsQuarterlyDividends } from '@/lib/us-quarterly-dividend';
import type { D1Database } from '@cloudflare/workers-types';

// 차트 컴포넌트는 worker bundle 크기 줄이기 위해 dynamic import (Recharts ~75KB gzip).
// 자세한 내용은 docs/worker-size-options.md 참조.
const DividendHistorySection = dynamic(() =>
  import('@/components/dashboard/DividendHistorySection').then((m) => ({
    default: m.DividendHistorySection,
  })),
);
const QuarterlyBarLineChart = dynamic(() =>
  import('@/components/charts/QuarterlyBarLineChart').then((m) => ({
    default: m.QuarterlyBarLineChart,
  })),
);
const QuarterlyStabilityChart = dynamic(() =>
  import('@/components/charts/QuarterlyStabilityChart').then((m) => ({
    default: m.QuarterlyStabilityChart,
  })),
);

// Cloudflare Pages 호환
export const runtime = 'edge';

interface PageProps {
  params: Promise<{ ticker: string }>;
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

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { ticker } = await params;
  const db = await getD1Optional();
  const data = await loadUsCompanyPageData(db, ticker.toUpperCase());

  if (!data.company) {
    return { title: '종목을 찾을 수 없습니다' };
  }

  return {
    title: `${data.company.name} (${data.company.ticker}) — 재무제표`,
    description: `${data.company.name}의 분기별 재무제표, 투자 지표, 배당 내역을 한눈에. PER, ROE, 부채비율 등 종합 분석.`,
  };
}

export const revalidate = 86400; // 24시간

export default async function UsCompanyPage({ params }: PageProps) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const db = await getD1Optional();
  const { company, financials, dividends } = await loadUsCompanyPageData(
    db,
    ticker,
  );

  if (!company) {
    notFound();
  }

  // ── 분기 시계열 (12분기 = 3년) ──
  const quarterly = buildUsQuarterlySeries(financials, 12);

  // ── TTM (PER/PSR 계산용) ──
  const { ttmRevenue, ttmNetIncome } = calculateTtm(financials);

  // ── 가장 최근 분기 BS (PBR/EPS/BPS 계산용) ──
  const latestRow = financials[0]; // DESC 정렬 → 최신
  const totalEquity = latestRow?.total_equity ?? null;
  const sharesOutstanding = latestRow?.shares_outstanding ?? null;
  const epsBasic = latestRow?.eps_basic ?? null;

  // BPS = 자본총계 / 발행주식수
  const bps =
    totalEquity && sharesOutstanding && sharesOutstanding > 0
      ? Number((totalEquity / sharesOutstanding).toFixed(2))
      : null;

  // 가치평가 비율
  const safeRatio = (
    numerator: number | null,
    denominator: number | null,
  ): number | null => {
    if (!numerator || !denominator || denominator <= 0) return null;
    const result = numerator / denominator;
    return Number.isFinite(result) ? Number(result.toFixed(2)) : null;
  };
  const per = safeRatio(company.market_cap, ttmNetIncome);
  const pbr = safeRatio(company.market_cap, totalEquity);
  const psr = safeRatio(company.market_cap, ttmRevenue);

  // ROE = TTM 순이익 / 자본총계 × 100
  const roe =
    ttmNetIncome && totalEquity && totalEquity > 0
      ? Number(((ttmNetIncome / totalEquity) * 100).toFixed(2))
      : null;

  // 부채비율 = 총부채 / 자본 × 100
  const debtRatio =
    latestRow?.total_liabilities && totalEquity && totalEquity > 0
      ? Number(((latestRow.total_liabilities / totalEquity) * 100).toFixed(2))
      : null;

  // ── 분기 배당 시계열 ──
  const dividendSummary = buildUsQuarterlyDividends(dividends);

  // 연간 배당수익률 (TTM dps × 4 / 주가) — 주가 데이터 없으니 시총 기반 근사
  // dividend_yield = (TTM dps × shares_outstanding) / market_cap × 100
  const ttmDps = dividendSummary.points
    .slice(-4)
    .reduce((sum, p) => sum + p.dividendPerShare, 0);
  const dividendYield =
    ttmDps > 0 &&
    sharesOutstanding &&
    company.market_cap &&
    company.market_cap > 0
      ? Number(
          (((ttmDps * sharesOutstanding) / company.market_cap) * 100).toFixed(
            2,
          ),
        )
      : null;
  const dividendPerShareAnnual = ttmDps > 0 ? Number(ttmDps.toFixed(4)) : null;

  // ── 인사이트 (분기 QoQ) ──
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
            corpName: company.name,
            stockCode: company.ticker,
            listedMarket: company.exchange ?? 'US',
            marketCap: company.market_cap,
            sector: company.sector,
            industry: company.industry,
          }}
          fiscalYearLabel={
            latestRow
              ? `FY${latestRow.fiscal_year} Q${latestRow.fiscal_quarter} 기준`
              : undefined
          }
          currency='USD'
        />

        {/* 2. 투자 지표 (PER/PBR/PSR/EPS/BPS/ROE/배당) */}
        <InvestmentMetricsCards
          metrics={{
            per,
            pbr,
            psr,
            eps: epsBasic,
            bps,
            roe,
            dividendYield,
            dividendPerShare: dividendPerShareAnnual,
            payoutRatio:
              dividendPerShareAnnual && epsBasic && epsBasic > 0
                ? Number(
                    ((dividendPerShareAnnual / (epsBasic * 4)) * 100).toFixed(
                      2,
                    ),
                  )
                : null,
          }}
          currency='USD'
        />

        {/* 3. 분기별 배당 시계열 (토스 스타일) */}
        {dividendSummary.points.length > 0 && (
          <DividendHistorySection
            points={dividendSummary.points}
            fiscalMonth={dividendSummary.fiscalMonth}
            currency='USD'
          />
        )}

        {/* 4. 안정성 지표 카드 */}
        <StabilityMetricsCards
          metrics={{
            debtRatio,
            currentRatio: null, // 추후 CurrentAssets/CurrentLiabilities 추가
            interestCoverage: null,
          }}
        />

        {/* 5. 수익성 차트 (분기별 매출 + 순이익) */}
        {quarterly.length > 0 && (
          <QuarterlyBarLineChart
            title='수익성'
            subtitle='매출·순이익 성장률'
            description={
              netIncomeQoQ !== null
                ? `${latestQuarter?.label} ${company.name}의 순이익은 직전 분기 대비 ${netIncomeQoQ >= 0 ? '+' : ''}${netIncomeQoQ.toFixed(1)}% ${netIncomeQoQ >= 0 ? '높아요' : '낮아요'}.`
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

        {/* 6. 성장성 차트 (영업이익) */}
        {quarterly.length > 0 && (
          <QuarterlyBarLineChart
            title='성장성'
            subtitle='영업이익 성장률'
            description={
              opQoQ !== null
                ? `${latestQuarter?.label} ${company.name}의 영업이익은 직전 분기 대비 ${opQoQ >= 0 ? '+' : ''}${opQoQ.toFixed(1)}% ${opQoQ >= 0 ? '높아요' : '낮아요'}.`
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

        {/* 7. 안정성 차트 (총자본/총부채/부채비율) */}
        {quarterly.length > 0 && (
          <QuarterlyStabilityChart quarters={quarterly} />
        )}

        {/* 8. 종합 평가 (HealthScoreCard 재활용 — 한국과 동일 점수 로직 유사 적용) */}
        {/* 미국용 HealthScore는 차후 별도 PR로 구현 — 지금은 생략 */}
      </div>
    </div>
  );
}
