/**
 * POST /api/sync/us-financials
 *
 * 두 형식 다 받음 (worker 함수 1개로 합쳐 size 한도 내 유지):
 *
 *  1. **us_financials_quarterly** — wide format (한 row = 1 분기, 12 컬럼)
 *     첫 row에 `revenue`/`operating_income` 같은 컬럼이 있으면 이쪽으로 INSERT.
 *
 *  2. **us_financial_facts** — long format (한 row = 1 fact)
 *     첫 row에 `category`/`account_name` 필드가 있으면 이쪽으로 INSERT.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 * 호출:
 *   - sync-us-financials.yml (wide format)
 *   - sync-us-income-statement.yml (long format)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { getD1, d1Batch, D1Error } from '@/lib/d1-client';

export const runtime = 'edge';

const BATCH_SIZE = 500;

// ── Wide format (us_financials_quarterly) ───────────────────────────────────
const wideItemSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(8)
    .regex(/^[A-Z][A-Z0-9.\-]*$/),
  fiscal_year: z.number().int().min(1990).max(2100),
  fiscal_quarter: z.number().int().min(1).max(4),
  period_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  revenue: z.number().optional().nullable(),
  operating_income: z.number().optional().nullable(),
  net_income: z.number().optional().nullable(),
  eps_basic: z.number().optional().nullable(),
  eps_diluted: z.number().optional().nullable(),
  total_assets: z.number().optional().nullable(),
  total_liabilities: z.number().optional().nullable(),
  total_equity: z.number().optional().nullable(),
  shares_outstanding: z.number().optional().nullable(),
  dividend_per_share: z.number().optional().nullable(),
});
const wideBodySchema = z.array(wideItemSchema).min(1).max(50_000);
type WideItem = z.infer<typeof wideItemSchema>;

// ── Long format (us_financial_facts) ────────────────────────────────────────
const factItemSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(8)
    .regex(/^[A-Z][A-Z0-9.\-]*$/),
  fiscal_year: z.number().int().min(1990).max(2100),
  period: z.enum(['Q1', 'Q2', 'Q3', 'Q4', 'FY']),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(['IS', 'BS', 'CF']),
  account_name: z.string().min(1).max(80),
  display_label: z.string().min(1).max(120),
  display_order: z.number().int().min(0).max(9999),
  value: z.number().nullable(),
});
const factBodySchema = z.array(factItemSchema).min(1).max(50_000);
type FactItem = z.infer<typeof factItemSchema>;

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET이 설정되지 않았습니다.' },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Long format (facts) 우선 시도 — category 필드로 식별
  const factResult = factBodySchema.safeParse(payload);
  if (factResult.success) {
    return handleFacts(factResult.data);
  }

  // Wide format fallback
  const wideResult = wideBodySchema.safeParse(payload);
  if (wideResult.success) {
    return handleWide(wideResult.data);
  }

  // 둘 다 실패 → 둘 중 더 가까운 에러 반환
  const issues = wideResult.error.issues
    .slice(0, 3)
    .map((i) => ({ path: i.path.join('.'), message: i.message }));
  return NextResponse.json(
    { error: 'Validation failed (neither wide nor long format)', issues },
    { status: 400 },
  );
}

async function handleWide(items: WideItem[]) {
  const db = await getD1();
  const upsertSql = `
    INSERT INTO us_financials_quarterly
    (ticker, fiscal_year, fiscal_quarter, period_start, period_end,
     revenue, operating_income, net_income, eps_basic, eps_diluted,
     total_assets, total_liabilities, total_equity,
     shares_outstanding, dividend_per_share, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker, fiscal_year, fiscal_quarter) DO UPDATE SET
      period_start       = COALESCE(excluded.period_start, us_financials_quarterly.period_start),
      period_end         = excluded.period_end,
      revenue            = COALESCE(excluded.revenue, us_financials_quarterly.revenue),
      operating_income   = COALESCE(excluded.operating_income, us_financials_quarterly.operating_income),
      net_income         = COALESCE(excluded.net_income, us_financials_quarterly.net_income),
      eps_basic          = COALESCE(excluded.eps_basic, us_financials_quarterly.eps_basic),
      eps_diluted        = COALESCE(excluded.eps_diluted, us_financials_quarterly.eps_diluted),
      total_assets       = COALESCE(excluded.total_assets, us_financials_quarterly.total_assets),
      total_liabilities  = COALESCE(excluded.total_liabilities, us_financials_quarterly.total_liabilities),
      total_equity       = COALESCE(excluded.total_equity, us_financials_quarterly.total_equity),
      shares_outstanding = COALESCE(excluded.shares_outstanding, us_financials_quarterly.shares_outstanding),
      dividend_per_share = COALESCE(excluded.dividend_per_share, us_financials_quarterly.dividend_per_share),
      fetched_at         = excluded.fetched_at
  `;
  return runBatch(db, upsertSql, items, (it) => [
    it.ticker,
    it.fiscal_year,
    it.fiscal_quarter,
    it.period_start ?? null,
    it.period_end,
    it.revenue ?? null,
    it.operating_income ?? null,
    it.net_income ?? null,
    it.eps_basic ?? null,
    it.eps_diluted ?? null,
    it.total_assets ?? null,
    it.total_liabilities ?? null,
    it.total_equity ?? null,
    it.shares_outstanding ?? null,
    it.dividend_per_share ?? null,
    Date.now(),
  ]);
}

async function handleFacts(items: FactItem[]) {
  const db = await getD1();
  const upsertSql = `
    INSERT INTO us_financial_facts
    (ticker, fiscal_year, period, period_end, category,
     account_name, display_label, display_order, value, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker, fiscal_year, period, category, account_name) DO UPDATE SET
      period_end    = excluded.period_end,
      display_label = excluded.display_label,
      display_order = excluded.display_order,
      value         = excluded.value,
      fetched_at    = excluded.fetched_at
  `;
  return runBatch(db, upsertSql, items, (it) => [
    it.ticker,
    it.fiscal_year,
    it.period,
    it.period_end,
    it.category,
    it.account_name,
    it.display_label,
    it.display_order,
    it.value,
    Date.now(),
  ]);
}

async function runBatch<T>(
  db: ReturnType<typeof getD1> extends Promise<infer R> ? R : never,
  sql: string,
  items: readonly T[],
  bindFn: (item: T) => readonly (string | number | null)[],
) {
  try {
    let inserted = 0;
    let chunks = 0;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const slice = items.slice(i, i + BATCH_SIZE);
      const stmts = slice.map((it) => db.prepare(sql).bind(...bindFn(it)));
      await d1Batch(db, stmts);
      inserted += slice.length;
      chunks += 1;
    }
    return NextResponse.json({
      success: true,
      received: items.length,
      inserted,
      chunks,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[sync/us-financials] Error:', error);
    if (error instanceof D1Error) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '알 수 없는 오류' },
      { status: 500 },
    );
  }
}
