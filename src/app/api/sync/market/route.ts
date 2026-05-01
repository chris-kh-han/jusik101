/**
 * POST /api/sync/market
 *
 * KRX/Naver Finance에서 가져온 시장 분류(KOSPI/KOSDAQ) + 시가총액을
 * D1 companies 테이블에 업데이트합니다.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 * 호출: GitHub Actions cron (매일 또는 주간)
 *
 * Request body 예시:
 * [
 *   {"stock_code": "005930", "market": "KOSPI", "market_cap": 500000000000000},
 *   {"stock_code": "000660", "market": "KOSPI", "market_cap": 200000000000000},
 *   ...
 * ]
 *
 * 동작:
 *   1. CRON_SECRET 검증
 *   2. 본문 JSON Zod 검증
 *   3. D1 batch UPDATE companies SET listed_market=?, market_cap=? WHERE stock_code=?
 *   4. 결과 반환: { success, updated, ... }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { getD1, d1Batch, D1Error } from '@/lib/d1-client';

// Cloudflare Pages 호환: Edge Runtime 명시
export const runtime = 'edge';

const BATCH_SIZE = 500;

const marketSchema = z.enum(['KOSPI', 'KOSDAQ', 'KONEX', 'OTHER']);

const itemSchema = z.object({
  stock_code: z.string().regex(/^\d{6}$/, '6자리 종목코드여야 함'),
  market: marketSchema,
  market_cap: z.number().int().nonnegative().optional().nullable(),
});

const bodySchema = z.array(itemSchema).min(1).max(10_000);

type MarketItem = z.infer<typeof itemSchema>;

export async function POST(request: Request) {
  // 1. 인증
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

  // 2. body 파싱 + 검증
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

  const items: MarketItem[] = parsed.data;

  // 3. D1 batch UPDATE
  try {
    const db = await getD1();
    const updateSql =
      'UPDATE companies SET listed_market = ?, market_cap = ? WHERE stock_code = ?';

    let totalUpdated = 0;
    let chunks = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const chunk = items.slice(i, i + BATCH_SIZE);
      const stmts = chunk.map((it) =>
        db
          .prepare(updateSql)
          .bind(it.market, it.market_cap ?? null, it.stock_code),
      );
      const results = await d1Batch(db, stmts);

      // D1 UPDATE는 results[i].meta.changes로 영향받은 row 수 확인 가능하지만
      // 단순하게 chunk 수만 count (실제 업데이트는 stock_code 매칭 여부에 따라 결정)
      totalUpdated += results.reduce<number>(
        (sum, r) => sum + (r.meta?.changes ?? 0),
        0,
      );
      chunks += 1;
    }

    return NextResponse.json({
      success: true,
      received: items.length,
      updated: totalUpdated,
      chunks,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[sync/market] Error:', error);

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
