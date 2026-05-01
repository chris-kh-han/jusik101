import type { DartFinancialItem, FsDiv, ReportCode } from '@/types/financial';
import { fetchFinancialStatements } from './dart-api';
import { checkDartApiLimit } from './rate-limit';

/**
 * 재무제표 데이터 조회 (Next.js fetch 캐시 활용)
 *
 * Next.js의 내장 fetch 캐시를 통해 동일한 요청은 자동으로 캐싱됩니다.
 * dart-api.ts 내부의 fetch에 { next: { revalidate: 86400 } } 설정이 되어 있어
 * 24시간 동안 캐시가 유지됩니다.
 *
 * 추후 Turso DB 캐시 레이어를 여기에 추가할 수 있습니다.
 */
export async function getCachedFinancials(
  corpCode: string,
  year: number,
  reportCode: ReportCode = '11011',
  fsDiv: FsDiv = 'CFS',
): Promise<readonly DartFinancialItem[]> {
  if (!checkDartApiLimit()) {
    throw new Error(
      'DART API 일일 호출 한도에 도달했습니다. 내일 다시 시도해주세요.',
    );
  }

  return fetchFinancialStatements(corpCode, year, reportCode, fsDiv);
}

/**
 * 현재 연도 기준 최신 사업보고서 연도 추정
 * 사업보고서는 전년도 기준이므로, 현재 연도 - 1 또는 - 2
 */
export function getLatestReportYear(): number {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // 사업보고서는 보통 3~4월에 공시됨
  // 4월 이후면 전년도, 4월 이전이면 전전년도
  return currentMonth >= 4 ? currentYear - 1 : currentYear - 2;
}

/**
 * 5개년 추세 데이터 조회
 */
export async function getMultiYearFinancials(
  corpCode: string,
  endYear: number,
  years: number = 5,
  fsDiv: FsDiv = 'CFS',
): Promise<ReadonlyMap<number, readonly DartFinancialItem[]>> {
  const results = new Map<number, readonly DartFinancialItem[]>();

  const yearRange = Array.from({ length: years }, (_, i) => endYear - i);

  const settled = await Promise.allSettled(
    yearRange.map(async (year) => {
      const data = await getCachedFinancials(corpCode, year, '11011', fsDiv);
      return { year, data };
    }),
  );

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.set(result.value.year, result.value.data);
    }
  }

  return results;
}
