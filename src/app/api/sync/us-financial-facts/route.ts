/**
 * POST /api/sync/us-financial-facts
 *
 * EDGAR companyfacts 파싱 결과 (24개 IS 항목 + 추후 BS/CF) → us_financial_facts UPSERT.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 * 호출: GitHub Actions sync-us-income-statement.yml
 *
 * Request body 예시:
 * [
 *   {
 *     "ticker": "AAPL", "fiscal_year": 2026, "period": "Q2",
 *     "period_end": "2026-03-28", "category": "IS",
 *     "account_name": "TotalRevenue", "display_label": "Total revenue",
 *     "display_order": 10, "value": 111184000000
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
  period: z.enum(['Q1', 'Q2', 'Q3', 'Q4', 'FY']),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(['IS', 'BS', 'CF']),
  account_name: z.string().min(1).max(80),
  display_label: z.string().min(1).max(120),
  display_order: z.number().int().min(0).max(9999),
  value: z.number().nullable(),
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
            it.period,
            it.period_end,
            it.category,
            it.account_name,
            it.display_label,
            it.display_order,
            it.value,
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
    console.error('[sync/us-financial-facts] Error:', error);
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
