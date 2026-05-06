/**
 * POST /api/sync/us-financials
 *
 * SEC EDGAR companyfacts 파싱 결과를 us_financials_quarterly에 UPSERT.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 * 호출: GitHub Actions sync-us-financials.yml (Python: scripts/fetch_us_financials.py)
 *
 * Request body 예시:
 * [
 *   {
 *     "ticker": "AAPL",
 *     "fiscal_year": 2026,
 *     "fiscal_quarter": 2,
 *     "period_start": "2025-12-28",
 *     "period_end": "2026-03-28",
 *     "revenue": 111184000000,
 *     "operating_income": 35885000000,
 *     "net_income": 29578000000,
 *     "eps_basic": 1.92,
 *     "eps_diluted": 1.91,
 *     "total_assets": 364840000000,
 *     "total_liabilities": 273380000000,
 *     "total_equity": 91460000000,
 *     "shares_outstanding": 14850000000,
 *     "dividend_per_share": 0.26
 *   },
 *   ...
 * ]
 */

import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { getD1, d1Batch, D1Error } from '@/lib/d1-client';

export const runtime = 'edge';

const BATCH_SIZE = 500;

const itemSchema = z.object({
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

const bodySchema = z.array(itemSchema).min(1).max(50_000);

type Item = z.infer<typeof itemSchema>;

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

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        issues: parsed.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const items: Item[] = parsed.data;

  try {
    const db = await getD1();
    // ON CONFLICT(ticker, fiscal_year, fiscal_quarter):
    // 모든 컬럼 새 값이 있을 때만 갱신 (null 안전)
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

    let inserted = 0;
    let chunks = 0;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const slice = items.slice(i, i + BATCH_SIZE);
      const stmts = slice.map((it) =>
        db
          .prepare(upsertSql)
          .bind(
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
          ),
      );
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
