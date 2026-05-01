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

  // SQLite LIKE는 ASCII만 case-insensitive (한글은 대소문자 개념 없으므로 OK)
  // SQL 인젝션 방지를 위해 항상 prepared statement 사용
  const sql = `
    SELECT corp_code, corp_name, stock_code, listed_market, MAX(score) as score
    FROM (
      -- 정확 일치
      SELECT corp_code, corp_name, stock_code, listed_market, 100 as score
      FROM companies
      WHERE corp_name = ?1 OR stock_code = ?1
      UNION ALL
      -- 회사명 접두사
      SELECT corp_code, corp_name, stock_code, listed_market, 80 as score
      FROM companies
      WHERE corp_name LIKE ?2
      UNION ALL
      -- 종목코드 접두사
      SELECT corp_code, corp_name, stock_code, listed_market, 75 as score
      FROM companies
      WHERE stock_code LIKE ?2
      UNION ALL
      -- 회사명 부분 일치
      SELECT corp_code, corp_name, stock_code, listed_market, 50 as score
      FROM companies
      WHERE corp_name LIKE ?3
      UNION ALL
      -- 종목코드 부분 일치
      SELECT corp_code, corp_name, stock_code, listed_market, 45 as score
      FROM companies
      WHERE stock_code LIKE ?3
    )
    GROUP BY corp_code
    ORDER BY score DESC, corp_name ASC
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
  };
}
