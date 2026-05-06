/**
 * us_financial_facts D1 조회 + 표 형태로 그룹핑.
 *
 * 표 모델:
 *   - 행: 24개 IS 항목 (display_order 기준 정렬)
 *   - 열: 분기 시계열 (period_end DESC) 또는 연간 (period='FY')
 */

import type { D1Database } from '@cloudflare/workers-types';
import { d1Query, D1Error } from './d1-client';

export interface FinancialFactRow {
  readonly ticker: string;
  readonly fiscal_year: number;
  readonly period: string; // 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'FY'
  readonly period_end: string;
  readonly category: string;
  readonly account_name: string;
  readonly display_label: string;
  readonly display_order: number;
  readonly value: number | null;
}

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

/** 표 컬럼 (분기 또는 연간) — 시간순 (최신 → 과거) */
export interface FactsColumn {
  readonly period_end: string;
  readonly period: string;
  readonly fiscal_year: number;
  readonly label: string; // 'Q2 ‘26' or 'FY 2025'
}

/** 표 행 (24개 IS 항목 등) */
export interface FactsRow {
  readonly account_name: string;
  readonly display_label: string;
  readonly display_order: number;
  /** period_end → value 매핑 */
  readonly values: ReadonlyMap<string, number | null>;
}

/** 표 그룹핑 결과 */
export interface FactsTable {
  readonly columns: readonly FactsColumn[];
  readonly rows: readonly FactsRow[];
}

/**
 * Long-format facts → 표 형태 (행/열).
 *
 * @param facts 모든 fact row (loadFinancialFacts 결과)
 * @param mode 'quarterly' (Q1~Q4 only) | 'annual' (FY only)
 * @param maxColumns 최대 표시 컬럼 (디폴트 16분기 또는 5년)
 */
export function buildFactsTable(
  facts: readonly FinancialFactRow[],
  mode: 'quarterly' | 'annual',
  maxColumns: number = 16,
): FactsTable {
  const wantPeriod = mode === 'annual' ? 'FY' : null;

  // 1) 컬럼 (period_end DESC unique)
  const colMap = new Map<string, FactsColumn>();
  for (const f of facts) {
    if (mode === 'annual') {
      if (f.period !== 'FY') continue;
    } else {
      if (f.period === 'FY') continue;
    }
    if (!colMap.has(f.period_end)) {
      colMap.set(f.period_end, {
        period_end: f.period_end,
        period: f.period,
        fiscal_year: f.fiscal_year,
        label: formatColumnLabel(f.period_end, f.period, f.fiscal_year, mode),
      });
    }
  }
  const columns = [...colMap.values()]
    .sort((a, b) => b.period_end.localeCompare(a.period_end))
    .slice(0, maxColumns)
    .reverse(); // 표시는 과거 → 최신

  const allowedEnds = new Set(columns.map((c) => c.period_end));

  // 2) 행: account별 (display_order 기준)
  const rowMap = new Map<
    string,
    {
      account_name: string;
      display_label: string;
      display_order: number;
      values: Map<string, number | null>;
    }
  >();
  for (const f of facts) {
    if (!allowedEnds.has(f.period_end)) continue;
    if (mode === 'annual' ? f.period !== 'FY' : f.period === 'FY') continue;
    let r = rowMap.get(f.account_name);
    if (!r) {
      r = {
        account_name: f.account_name,
        display_label: f.display_label,
        display_order: f.display_order,
        values: new Map(),
      };
      rowMap.set(f.account_name, r);
    }
    r.values.set(f.period_end, f.value);
  }
  const rows = [...rowMap.values()].sort(
    (a, b) => a.display_order - b.display_order,
  );

  return { columns, rows: rows as FactsRow[] };
}

function formatColumnLabel(
  periodEnd: string,
  period: string,
  fiscalYear: number,
  mode: 'quarterly' | 'annual',
): string {
  if (mode === 'annual') {
    return `FY ${fiscalYear}`;
  }
  // 분기: 'Q2 '26\nMar 2026' 같은 multi-line
  const yy = String(fiscalYear).slice(2);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const m = parseInt(periodEnd.slice(5, 7), 10);
  const y = periodEnd.slice(0, 4);
  return `${period} '${yy}\n${months[m - 1] ?? ''} ${y}`;
}

/** TTM 컬럼 — 직전 4분기 합 (PnL 항목만 의미 있음) */
export function calculateTtmColumn(
  facts: readonly FinancialFactRow[],
): ReadonlyMap<string, number | null> {
  // 분기 데이터만 (Q1~Q4)
  const quarterly = facts.filter((f) => f.period !== 'FY');

  // account별 그룹
  const byAccount = new Map<string, FinancialFactRow[]>();
  for (const f of quarterly) {
    if (!byAccount.has(f.account_name)) byAccount.set(f.account_name, []);
    byAccount.get(f.account_name)!.push(f);
  }

  const ttmMap = new Map<string, number | null>();
  for (const [account, rows] of byAccount) {
    // period_end DESC 정렬, top 4
    const top4 = [...rows]
      .sort((a, b) => b.period_end.localeCompare(a.period_end))
      .slice(0, 4);
    if (top4.length < 4) continue;
    const sum = top4.reduce<number | null>(
      (acc, r) => (acc === null || r.value === null ? null : acc + r.value),
      0,
    );
    ttmMap.set(account, sum);
  }
  return ttmMap;
}
