/**
 * us_financial_facts D1 조회 (server-only).
 *
 * 표 변환 함수는 us-financial-facts-utils.ts에 분리 (client-safe).
 */

import type { D1Database } from '@cloudflare/workers-types';
import { d1Query, D1Error } from './d1-client';
import type { FinancialFactRow } from './us-financial-facts-utils';

// re-export
export type {
  FinancialFactRow,
  FactsColumn,
  FactsRow,
  FactsTable,
} from './us-financial-facts-utils';
export {
  buildFactsTable,
  calculateTtmColumn,
} from './us-financial-facts-utils';

/** 한 종목 + 카테고리(IS/BS/CF)의 모든 fact row (최신 → 과거) */
export async function loadFinancialFacts(
  db: D1Database | null,
  ticker: string,
  category: 'IS' | 'BS' | 'CF',
): Promise<readonly FinancialFactRow[]> {
  if (!db) return [];
  try {
    return await d1Query<FinancialFactRow>(
      db,
      `SELECT ticker, fiscal_year, period, period_end, category,
              account_name, display_label, display_order, value
       FROM us_financial_facts
       WHERE ticker = ? AND category = ?
       ORDER BY period_end DESC, display_order ASC`,
      [ticker.toUpperCase(), category],
    );
  } catch (error) {
    if (error instanceof D1Error) return [];
    throw error;
  }
}
