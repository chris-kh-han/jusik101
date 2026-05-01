/**
 * 회사 페이지용 데이터 로더
 *
 * D1 캐시 우선 → DART API fallback.
 * 12분기 + 4 재무비율 + 1 배당 + 1 기업개황 = 18개 호출 (캐시 hit이면 0회).
 *
 * 모든 fetch는 Promise.allSettled로 병렬 — 일부 실패해도 가능한 섹션 표시.
 */

import type { D1Database } from '@cloudflare/workers-types';
import {
  fetchCompanyDetail,
  fetchFinancialStatements,
  fetchFinancialIndex,
  fetchDividend,
  INDEX_CATEGORIES,
  type DartCompanyDetail,
  type DartFinancialIndex,
  type DartDividendItem,
  type IndexCategoryCode,
} from './dart-api';
import { cacheOrFetch } from './financial-cache';
import type { DartFinancialItem, ReportCode, FsDiv } from '@/types/financial';

const REPORT_CODES: readonly ReportCode[] = [
  '11013', // 1분기
  '11012', // 반기
  '11014', // 3분기
  '11011', // 사업
];

export interface QuarterlyReport {
  readonly year: number;
  readonly reportCode: ReportCode;
  readonly items: readonly DartFinancialItem[];
}

/**
 * 12분기 데이터 fetch (3년치)
 */
export async function loadQuarterlyReports(
  db: D1Database | null,
  corpCode: string,
  endYear: number,
  fsDiv: FsDiv = 'CFS',
): Promise<readonly QuarterlyReport[]> {
  // 3년 × 4보고서 = 12개
  const targets: Array<{ year: number; reportCode: ReportCode }> = [];
  for (let y = endYear - 2; y <= endYear; y++) {
    for (const code of REPORT_CODES) {
      targets.push({ year: y, reportCode: code });
    }
  }

  const settled = await Promise.allSettled(
    targets.map(async ({ year, reportCode }) => {
      const items = await cacheOrFetch(
        db,
        {
          corpCode,
          bsnsYear: year,
          reprtCode: reportCode,
          fsDiv,
          endpoint: 'fnlttSinglAcntAll',
        },
        () => fetchFinancialStatements(corpCode, year, reportCode, fsDiv),
      );
      return { year, reportCode, items };
    }),
  );

  return settled
    .filter(
      (r): r is PromiseFulfilledResult<QuarterlyReport> =>
        r.status === 'fulfilled' && r.value.items.length > 0,
    )
    .map((r) => r.value);
}

/**
 * 재무비율 4 카테고리 fetch
 */
export async function loadFinancialIndices(
  db: D1Database | null,
  corpCode: string,
  year: number,
  reportCode: ReportCode = '11011',
): Promise<readonly DartFinancialIndex[]> {
  const settled = await Promise.allSettled(
    INDEX_CATEGORIES.map(async (idxClCode: IndexCategoryCode) => {
      return cacheOrFetch(
        db,
        {
          corpCode,
          bsnsYear: year,
          reprtCode: reportCode,
          endpoint: 'fnlttSinglIndx',
          idxClCode,
        },
        () => fetchFinancialIndex(corpCode, year, reportCode, idxClCode),
      );
    }),
  );

  const all: DartFinancialIndex[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      all.push(...r.value);
    }
  }
  return all;
}

/** 배당 데이터 fetch */
export async function loadDividend(
  db: D1Database | null,
  corpCode: string,
  year: number,
  reportCode: ReportCode = '11011',
): Promise<readonly DartDividendItem[]> {
  try {
    return await cacheOrFetch(
      db,
      {
        corpCode,
        bsnsYear: year,
        reprtCode: reportCode,
        endpoint: 'alotMatter',
      },
      () => fetchDividend(corpCode, year, reportCode),
    );
  } catch {
    return [];
  }
}

/** 기업 개황 fetch (CEO, 홈페이지 등 raw 데이터) */
export async function loadCompanyInfo(
  db: D1Database | null,
  corpCode: string,
): Promise<DartCompanyDetail | null> {
  try {
    return await cacheOrFetch(
      db,
      {
        corpCode,
        bsnsYear: new Date().getFullYear(),
        reprtCode: '-',
        endpoint: 'company',
      },
      async () => {
        const detail = await fetchCompanyDetail(corpCode);
        if (!detail) throw new Error('company info not found');
        return detail;
      },
    );
  } catch {
    return null;
  }
}

/**
 * 회사 페이지에 필요한 모든 데이터 한 번에 로드
 *
 * 캐시 hit 시 0회 외부 호출.
 * 캐시 miss 시 12 (분기) + 4 (재무비율) + 1 (배당) + 1 (개황) = 18회 병렬 호출.
 */
export async function loadCompanyPageData(
  db: D1Database | null,
  corpCode: string,
  endYear: number,
  fsDiv: FsDiv = 'CFS',
) {
  const [quarterlyReports, indices, dividend, companyInfo] = await Promise.all([
    loadQuarterlyReports(db, corpCode, endYear, fsDiv),
    loadFinancialIndices(db, corpCode, endYear, '11011'),
    loadDividend(db, corpCode, endYear, '11011'),
    loadCompanyInfo(db, corpCode),
  ]);

  return { quarterlyReports, indices, dividend, companyInfo };
}

/** 재무비율 raw → InvestmentMetrics + StabilityMetrics 매핑 */
export function extractMetricsFromIndices(
  indices: readonly DartFinancialIndex[],
): {
  investment: {
    roe: number | null;
  };
  stability: {
    debtRatio: number | null;
    currentRatio: number | null;
  };
} {
  const findVal = (idxNm: string): number | null => {
    const item = indices.find((i) => i.idx_nm === idxNm);
    if (!item || !item.idx_val || item.idx_val === '-') return null;
    const n = Number(item.idx_val.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  return {
    investment: {
      roe: findVal('ROE'),
    },
    stability: {
      debtRatio: findVal('부채비율'),
      currentRatio: findVal('유동비율'),
    },
  };
}

/** 배당 raw → InvestmentMetrics 일부 필드 */
export function extractDividendMetrics(dividend: readonly DartDividendItem[]): {
  dividendYield: number | null;
  dividendPerShare: number | null;
  payoutRatio: number | null;
} {
  const parseFloat3 = (raw: string | undefined): number | null => {
    if (!raw || raw === '-' || raw === '') return null;
    const n = Number(raw.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  // 보통주 우선 (없으면 첫 항목)
  const findItem = (se: string) => {
    const common = dividend.find(
      (d) => d.se === se && d.stock_knd === '보통주',
    );
    return common ?? dividend.find((d) => d.se === se);
  };

  return {
    dividendYield: parseFloat3(findItem('현금배당수익률(%)')?.thstrm),
    dividendPerShare: parseFloat3(findItem('주당 현금배당금(원)')?.thstrm),
    payoutRatio: parseFloat3(findItem('(연결)현금배당성향(%)')?.thstrm),
  };
}
