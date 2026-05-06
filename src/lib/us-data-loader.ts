/**
 * 미국 종목 페이지용 D1 조회 유틸
 *
 * 한국과 다른 점:
 *   - DART API 직접 호출 안 함 (모든 데이터 D1 적재 끝난 상태에서 SELECT)
 *   - financial_cache 거치지 않음 (이미 us_financials_quarterly에 정제된 분기 데이터)
 *   - cron sync (sync-us-companies, sync-us-financials, sync-us-dividends) 책임
 */

import type { D1Database } from '@cloudflare/workers-types';
import { d1Query, d1QueryFirst, D1Error } from './d1-client';

/** us_companies row */
export interface UsCompanyRow {
  readonly ticker: string;
  readonly cik: string;
  readonly name: string;
  readonly exchange: string | null;
  readonly sector: string | null;
  readonly industry: string | null;
  readonly market_cap: number | null;
  readonly is_sp500: number;
}

/** us_financials_quarterly row */
export interface UsFinancialRow {
  readonly ticker: string;
  readonly fiscal_year: number;
  readonly fiscal_quarter: number;
  readonly period_start: string | null;
  readonly period_end: string;
  readonly revenue: number | null;
  readonly operating_income: number | null;
  readonly net_income: number | null;
  readonly eps_basic: number | null;
  readonly eps_diluted: number | null;
  readonly total_assets: number | null;
  readonly total_liabilities: number | null;
  readonly total_equity: number | null;
  readonly shares_outstanding: number | null;
  readonly dividend_per_share: number | null;
}

/** us_dividends row */
export interface UsDividendRow {
  readonly ticker: string;
  readonly ex_dividend_date: string;
  readonly record_date: string | null;
  readonly payment_date: string | null;
  readonly dividend_per_share: number;
  readonly dividend_type: string;
  readonly source: string;
}

/** ticker로 회사 정보 1건 */
export async function loadUsCompany(
  db: D1Database | null,
  ticker: string,
): Promise<UsCompanyRow | null> {
  if (!db) return null;
  try {
    const row = await d1QueryFirst<UsCompanyRow>(
      db,
      `SELECT ticker, cik, name, exchange, sector, industry, market_cap, is_sp500
       FROM us_companies
       WHERE ticker = ?`,
      [ticker.toUpperCase()],
    );
    return row;
  } catch (error) {
    if (error instanceof D1Error) return null;
    throw error;
  }
}

/**
 * 분기별 재무 시계열 (최신 → 과거).
 *
 * @param maxQuarters 최대 행 수 (디폴트 20 = 5년치)
 */
export async function loadUsFinancials(
  db: D1Database | null,
  ticker: string,
  maxQuarters: number = 20,
): Promise<readonly UsFinancialRow[]> {
  if (!db) return [];
  try {
    const rows = await d1Query<UsFinancialRow>(
      db,
      `SELECT
         ticker, fiscal_year, fiscal_quarter, period_start, period_end,
         revenue, operating_income, net_income, eps_basic, eps_diluted,
         total_assets, total_liabilities, total_equity,
         shares_outstanding, dividend_per_share
       FROM us_financials_quarterly
       WHERE ticker = ?
       ORDER BY period_end DESC
       LIMIT ?`,
      [ticker.toUpperCase(), maxQuarters],
    );
    return rows;
  } catch (error) {
    if (error instanceof D1Error) return [];
    throw error;
  }
}

/**
 * 배당 events 시계열 (최신 → 과거).
 *
 * @param maxEvents 최대 행 수 (디폴트 40 = 10년치 분기 배당)
 */
export async function loadUsDividends(
  db: D1Database | null,
  ticker: string,
  maxEvents: number = 40,
): Promise<readonly UsDividendRow[]> {
  if (!db) return [];
  try {
    const rows = await d1Query<UsDividendRow>(
      db,
      `SELECT
         ticker, ex_dividend_date, record_date, payment_date,
         dividend_per_share, dividend_type, source
       FROM us_dividends
       WHERE ticker = ? AND dividend_type = 'CASH'
       ORDER BY ex_dividend_date DESC
       LIMIT ?`,
      [ticker.toUpperCase(), maxEvents],
    );
    return rows;
  } catch (error) {
    if (error instanceof D1Error) return [];
    throw error;
  }
}

/** 페이지에 필요한 모든 데이터 한 번에 로드 */
export async function loadUsCompanyPageData(
  db: D1Database | null,
  ticker: string,
) {
  const [company, financials, dividends] = await Promise.all([
    loadUsCompany(db, ticker),
    loadUsFinancials(db, ticker, 20),
    loadUsDividends(db, ticker, 40),
  ]);
  return { company, financials, dividends };
}
