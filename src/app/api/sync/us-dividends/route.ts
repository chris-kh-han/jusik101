/**
 * POST /api/sync/us-dividends
 *
 * FDR(Yahoo) ex-date 시계열 + EDGAR companyfacts fallback 결과를 us_dividends에 UPSERT.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 * 호출: GitHub Actions sync-us-dividends.yml (Python: scripts/fetch_us_dividends.py)
 *
 * Request body 예시:
 * [
 *   {
 *     "ticker": "AAPL",
 *     "ex_dividend_date": "2025-02-10",
 *     "payment_date": null,
 *     "dividend_per_share": 0.25,
 *     "dividend_type": "CASH",
 *     "source": "yahoo"
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
  ex_dividend_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  record_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  payment_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  dividend_per_share: z.number().positive(),
  dividend_type: z.enum(['CASH', 'STOCK']).optional().default('CASH'),
  source: z.enum(['yahoo', 'edgar', 'manual']),
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
      INSERT INTO us_dividends
      (ticker, ex_dividend_date, record_date, payment_date,
       dividend_per_share, dividend_type, source, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ticker, ex_dividend_date, dividend_type) DO UPDATE SET
        record_date         = COALESCE(excluded.record_date, us_dividends.record_date),
        payment_date        = COALESCE(excluded.payment_date, us_dividends.payment_date),
        dividend_per_share  = excluded.dividend_per_share,
        source              = excluded.source,
        fetched_at          = excluded.fetched_at
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
            it.ex_dividend_date,
            it.record_date ?? null,
            it.payment_date ?? null,
            it.dividend_per_share,
            it.dividend_type,
            it.source,
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
    console.error('[sync/us-dividends] Error:', error);
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
