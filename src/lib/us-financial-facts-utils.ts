/**
 * us_financial_facts 표 변환 유틸 (client-safe).
 *
 * D1 조회 함수는 us-financial-facts-loader.ts에 분리 (server-only).
 * 이 파일은 순수 함수만 — 'use client' 컴포넌트에서 import 가능.
 */

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

export interface FactsColumn {
  readonly period_end: string;
  readonly period: string;
  readonly fiscal_year: number;
  readonly label: string;
}

export interface FactsRow {
  readonly account_name: string;
  readonly display_label: string;
  readonly display_order: number;
  readonly values: ReadonlyMap<string, number | null>;
}

export interface FactsTable {
  readonly columns: readonly FactsColumn[];
  readonly rows: readonly FactsRow[];
}

export function buildFactsTable(
  facts: readonly FinancialFactRow[],
  mode: 'quarterly' | 'annual',
  maxColumns: number = 16,
): FactsTable {
  const colMap = new Map<string, FactsColumn>();
  for (const f of facts) {
    if (mode === 'annual' ? f.period !== 'FY' : f.period === 'FY') continue;
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
    .reverse();

  const allowedEnds = new Set(columns.map((c) => c.period_end));

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
  if (mode === 'annual') return `FY ${fiscalYear}`;
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

export function calculateTtmColumn(
  facts: readonly FinancialFactRow[],
): ReadonlyMap<string, number | null> {
  const quarterly = facts.filter((f) => f.period !== 'FY');
  const byAccount = new Map<string, FinancialFactRow[]>();
  for (const f of quarterly) {
    if (!byAccount.has(f.account_name)) byAccount.set(f.account_name, []);
    byAccount.get(f.account_name)!.push(f);
  }
  const ttmMap = new Map<string, number | null>();
  for (const [account, rows] of byAccount) {
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
