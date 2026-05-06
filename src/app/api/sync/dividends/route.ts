/**
 * POST /api/sync/dividends
 *
 * KRX 또는 사용자 큐레이션 데이터로부터 받은 배당 내역을 D1에 저장.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 * 호출: GitHub Actions sync-dividends.yml (Python + KRX 로그인)
 *
 * Request body 예시:
 * [
 *   {
 *     "stock_code": "005930",
 *     "ex_dividend_date": "2025-12-30",
 *     "payment_date": "2026-04-15",
 *     "dividend_per_share": 417,
 *     "dividend_yield": 0.5,
 *     "dividend_type": "CASH",
 *     "source": "krx"
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
  stock_code: z.string().regex(/^\d{6}$/),
  ex_dividend_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  dividend_per_share: z.number().int().nonnegative(),
  dividend_yield: z.number().nonnegative().optional().nullable(),
  dividend_type: z.enum(['CASH', 'STOCK']).optional().default('CASH'),
  source: z.enum(['krx', 'dart', 'manual']),
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
      INSERT INTO dividend_disclosures
      (stock_code, ex_dividend_date, payment_date, dividend_per_share, dividend_yield, dividend_type, source, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stock_code, ex_dividend_date, dividend_type) DO UPDATE SET
        payment_date = excluded.payment_date,
        dividend_per_share = excluded.dividend_per_share,
        dividend_yield = excluded.dividend_yield,
        source = excluded.source,
        fetched_at = excluded.fetched_at
    `;

    let inserted = 0;
    let chunks = 0;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const slice = items.slice(i, i + BATCH_SIZE);
      const stmts = slice.map((it) =>
        db
          .prepare(upsertSql)
          .bind(
            it.stock_code,
            it.ex_dividend_date,
            it.payment_date ?? null,
            it.dividend_per_share,
            it.dividend_yield ?? null,
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
    console.error('[sync/dividends] Error:', error);
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
