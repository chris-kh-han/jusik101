/**
 * D1 기반 기업 검색
 *
 * 기존 src/lib/company-search.ts의 정적 JSON 검색을 D1으로 대체.
 * 2,500+ 종목을 빠르게 검색 (인덱스 활용).
 *
 * 검색 전략:
 * 1. 정확 일치 (corp_name 또는 stock_code)        → score 100
 * 2. 접두사 일치 (corp_name LIKE 'q%')             → score 80
 * 3. 접두사 일치 (stock_code LIKE 'q%')            → score 75
 * 4. 부분 일치 (corp_name LIKE '%q%')              → score 50
 * 5. 부분 일치 (stock_code LIKE '%q%')             → score 45
 *
 * UNION + DISTINCT로 중복 제거 후 score 내림차순 정렬.
 */

import type { SearchResult } from '@/types/financial';
import { d1Query, d1QueryFirst, getD1, D1Error } from './d1-client';

interface CompanyRow {
  readonly corp_code: string;
  readonly corp_name: string;
  readonly stock_code: string | null;
  readonly listed_market: string | null;
  readonly market_cap?: number | null;
  readonly nation?: string | null; // 'KR' | 'US' (UNION 시)
}

interface ScoredCompanyRow extends CompanyRow {
  readonly score: number;
}

/**
 * D1에서 기업 검색
 *
 * @param query 검색어 (회사명 또는 종목코드)
 * @param limit 최대 결과 수 (기본 10)
 */
export async function searchCompaniesD1(
  query: string,
  limit: number = 10,
): Promise<readonly SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const db = await getD1();
  const lowerQuery = trimmed.toLowerCase();

  // 한·미 통합 검색.
  // D1 SQLite의 compound SELECT terms 한도 때문에 UNION을 KR+US 2단계로 줄이고
  // score는 CASE WHEN으로 계산 (정확/접두사/부분 일치 점수 차등).
  //
  //   ?1 = 정확 일치 검색어 (lowercase)
  //   ?2 = '검색어%' (접두사 LIKE)
  //   ?3 = '%검색어%' (부분 LIKE)
  //   ?4 = limit
  const sql = `
    SELECT corp_code, corp_name, stock_code, listed_market, market_cap, nation,
      CASE
        WHEN corp_name_lower = ?1 OR stock_code_lower = ?1 THEN 100
        WHEN corp_name_lower LIKE ?2 THEN 80
        WHEN stock_code_lower LIKE ?2 THEN 75
        WHEN corp_name_lower LIKE ?3 THEN 50
        WHEN stock_code_lower LIKE ?3 THEN 45
        ELSE 0
      END AS score
    FROM (
      SELECT corp_code, corp_name, stock_code, listed_market, market_cap,
             'KR' AS nation,
             LOWER(corp_name) AS corp_name_lower,
             LOWER(COALESCE(stock_code, '')) AS stock_code_lower
      FROM companies
      WHERE LOWER(corp_name) LIKE ?3 OR LOWER(COALESCE(stock_code, '')) LIKE ?3
      UNION ALL
      SELECT ticker AS corp_code, name AS corp_name, ticker AS stock_code,
             COALESCE(exchange, 'US') AS listed_market, market_cap,
             'US' AS nation,
             LOWER(name) AS corp_name_lower,
             LOWER(ticker) AS stock_code_lower
      FROM us_companies
      WHERE LOWER(name) LIKE ?3 OR LOWER(ticker) LIKE ?3
    )
    WHERE score > 0
    ORDER BY score DESC, market_cap DESC, corp_name ASC
    LIMIT ?4
  `;

  const rows = await d1Query<ScoredCompanyRow>(db, sql, [
    lowerQuery, // ?1 정확 일치
    `${lowerQuery}%`, // ?2 접두사
    `%${lowerQuery}%`, // ?3 부분 일치
    limit, // ?4
  ]);

  return rows.map(rowToSearchResult);
}

/**
 * corpCode로 기업 정보 조회
 */
export async function findCompanyByCodeD1(
  corpCode: string,
): Promise<SearchResult | null> {
  const db = await getD1();
  const row = await d1QueryFirst<CompanyRow>(
    db,
    'SELECT corp_code, corp_name, stock_code, listed_market FROM companies WHERE corp_code = ?',
    [corpCode],
  );
  return row ? rowToSearchResult(row) : null;
}

/**
 * 종목코드로 기업 정보 조회
 */
export async function findCompanyByStockCodeD1(
  stockCode: string,
): Promise<SearchResult | null> {
  const db = await getD1();
  const row = await d1QueryFirst<CompanyRow>(
    db,
    'SELECT corp_code, corp_name, stock_code, listed_market FROM companies WHERE stock_code = ?',
    [stockCode],
  );
  return row ? rowToSearchResult(row) : null;
}

/**
 * 여러 종목코드로 일괄 조회 (인기 기업 등)
 */
export async function findCompaniesByStockCodesD1(
  stockCodes: readonly string[],
): Promise<readonly SearchResult[]> {
  if (stockCodes.length === 0) return [];

  const db = await getD1();
  const placeholders = stockCodes.map(() => '?').join(', ');
  const rows = await d1Query<CompanyRow>(
    db,
    `SELECT corp_code, corp_name, stock_code, listed_market
     FROM companies
     WHERE stock_code IN (${placeholders})`,
    stockCodes,
  );

  // 입력 순서 보존
  const byStockCode = new Map(rows.map((r) => [r.stock_code, r]));
  return stockCodes
    .map((sc) => byStockCode.get(sc))
    .filter((r): r is CompanyRow => r !== undefined)
    .map(rowToSearchResult);
}

/**
 * D1 사용 가능 여부 (fallback 결정용)
 */
export async function isD1Available(): Promise<boolean> {
  try {
    await getD1();
    return true;
  } catch (error) {
    if (error instanceof D1Error) return false;
    throw error;
  }
}

/** D1 row → 외부 SearchResult 타입 변환 (snake_case → camelCase) */
function rowToSearchResult(row: CompanyRow): SearchResult {
  return {
    corpCode: row.corp_code,
    corpName: row.corp_name,
    stockCode: row.stock_code ?? '',
    listedMarket: row.listed_market ?? '',
    nation: row.nation === 'US' ? 'US' : 'KR',
  };
}
