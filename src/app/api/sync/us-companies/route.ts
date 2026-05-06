/**
 * POST /api/sync/us-companies
 *
 * SEC ticker_map + FDR 시총/섹터 결합 결과를 D1 us_companies에 UPSERT.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 * 호출: GitHub Actions sync-us-companies.yml (Python: scripts/fetch_us_companies.py)
 *
 * Request body 예시:
 * [
 *   {
 *     "ticker": "AAPL",
 *     "cik": "0000320193",
 *     "name": "Apple Inc.",
 *     "exchange": "NASDAQ",
 *     "sector": "Information Technology",
 *     "industry": "Technology Hardware, Storage & Peripherals",
 *     "market_cap": 3500000000000,
 *     "is_sp500": 1
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
  cik: z.string().regex(/^\d{10}$/),
  name: z.string().min(1).max(200),
  exchange: z.string().max(20).optional().nullable(),
  sector: z.string().max(100).optional().nullable(),
  industry: z.string().max(200).optional().nullable(),
  market_cap: z.number().int().positive().optional().nullable(),
  is_sp500: z
    .union([z.literal(0), z.literal(1)])
    .optional()
    .default(0),
});

const bodySchema = z.array(itemSchema).min(1).max(20_000);

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
    // ON CONFLICT(ticker): cik/name은 항상 갱신, market_cap/sector/industry/is_sp500은 새 값이 있을 때만 갱신
    const upsertSql = `
      INSERT INTO us_companies
      (ticker, cik, name, exchange, sector, industry, market_cap, is_sp500, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ticker) DO UPDATE SET
        cik         = excluded.cik,
        name        = excluded.name,
        exchange    = COALESCE(excluded.exchange, us_companies.exchange),
        sector      = COALESCE(excluded.sector, us_companies.sector),
        industry    = COALESCE(excluded.industry, us_companies.industry),
        market_cap  = COALESCE(excluded.market_cap, us_companies.market_cap),
        is_sp500    = excluded.is_sp500,
        fetched_at  = excluded.fetched_at
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
            it.cik,
            it.name,
            it.exchange ?? null,
            it.sector ?? null,
            it.industry ?? null,
            it.market_cap ?? null,
            it.is_sp500,
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
    console.error('[sync/us-companies] Error:', error);
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
