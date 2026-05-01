/**
 * 인기 기업 (메인 페이지 칩 표시용)
 *
 * 종목코드는 하드코딩하고 회사명/시장은 D1에서 조회.
 * 사유: 인기 기업 변경 빈도 낮음 + D1 비용 절약 + 종목코드는 거의 안 변함.
 */

import type { SearchResult } from '@/types/financial';
import { findCompaniesByStockCodesD1 } from './company-search-d1';

/** 메인 페이지 인기 기업 종목코드 (12개) */
export const POPULAR_STOCK_CODES = [
  '005930', // 삼성전자
  '000660', // SK하이닉스
  '373220', // LG에너지솔루션
  '005380', // 현대자동차
  '207940', // 삼성바이오로직스
  '000270', // 기아
  '068270', // 셀트리온
  '105560', // KB금융
  '005490', // POSCO홀딩스
  '055550', // 신한지주
  '035420', // NAVER
  '012330', // 현대모비스
] as const;

/** D1에서 인기 기업 정보 조회 */
export async function getPopularCompaniesD1(): Promise<
  readonly SearchResult[]
> {
  return findCompaniesByStockCodesD1(POPULAR_STOCK_CODES);
}
