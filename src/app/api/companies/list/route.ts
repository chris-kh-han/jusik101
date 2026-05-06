/**
 * GET /api/companies/list
 *
 * 메인 페이지 토스 스타일 회사 목록 (필터 + 정렬 + 페이지네이션).
 *
 * Query params:
 *   - nation: 'all' | 'kr' | 'us'  (디폴트 'all')
 *   - sort:   'marketcap_desc' | 'marketcap_asc' | 'name'  (디폴트 'marketcap_desc')
 *   - limit:  1~100  (디폴트 20)
 *   - offset: 0+    (디폴트 0)
 *
 * 시세 데이터는 D1에 없어 거래대금/거래량 정렬은 미지원.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { d1Query, getD1, D1Error } from '@/lib/d1-client';
import type { Nation, SearchResult } from '@/types/financial';

export const runtime = 'edge';

const querySchema = z.object({
  nation: z.enum(['all', 'kr', 'us']).optional().default('all'),
  sort: z
    .enum(['marketcap_desc', 'marketcap_asc', 'name'])
    .optional()
    .default('marketcap_desc'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).max(10_000).optional().default(0),
});

interface CompanyListRow {
  readonly corp_code: string;
  readonly corp_name: string;
  readonly stock_code: string | null;
  readonly listed_market: string | null;
  readonly market_cap: number | null;
  readonly nation: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    nation: searchParams.get('nation') ?? undefined,
    sort: searchParams.get('sort') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
  });

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

  const { nation, sort, limit, offset } = parsed.data;

  // 시총 정렬 시 nation 별 단위 다름 (KR 원 / US 달러) → KRW 단일 단위로 환산
  // 환율은 대략 (정확한 시세 데이터 없음). ranking 용도라 ±5% 오차 허용.
  const KRW_PER_USD = 1380;
  const marketCapKrw = `(CASE WHEN nation = 'US' THEN market_cap * ${KRW_PER_USD} ELSE market_cap END)`;

  // 정렬 SQL fragment
  const orderBy = (() => {
    switch (sort) {
      case 'marketcap_asc':
        return `${marketCapKrw} ASC NULLS LAST`;
      case 'name':
        return 'corp_name ASC';
      case 'marketcap_desc':
      default:
        return `${marketCapKrw} DESC NULLS LAST`;
    }
  })();

  // nation 필터 → UNION 부분 결정
  const includeKr = nation === 'all' || nation === 'kr';
  const includeUs = nation === 'all' || nation === 'us';

  const krSelect = `
    SELECT corp_code, corp_name, stock_code, listed_market, market_cap, 'KR' AS nation
    FROM companies
    WHERE stock_code IS NOT NULL
  `;
  const usSelect = `
    SELECT ticker AS corp_code, name AS corp_name, ticker AS stock_code,
           COALESCE(exchange, 'US') AS listed_market, market_cap, 'US' AS nation
    FROM us_companies
  `;

  let unionSql: string;
  if (includeKr && includeUs) {
    unionSql = `${krSelect} UNION ALL ${usSelect}`;
  } else if (includeKr) {
    unionSql = krSelect;
  } else {
    unionSql = usSelect;
  }

  const sql = `
    SELECT * FROM (${unionSql})
    ORDER BY ${orderBy}
    LIMIT ?1 OFFSET ?2
  `;

  try {
    const db = await getD1();
    const rows = await d1Query<CompanyListRow>(db, sql, [limit, offset]);

    const results: SearchResult[] = rows.map((r) => ({
      corpCode: r.corp_code,
      corpName: r.corp_name,
      stockCode: r.stock_code ?? '',
      listedMarket: r.listed_market ?? '',
      nation: r.nation === 'US' ? 'US' : 'KR',
    }));

    // 시가총액도 같이 반환 — UI에 표시용
    const resultsWithCap = rows.map((r) => ({
      corpCode: r.corp_code,
      corpName: r.corp_name,
      stockCode: r.stock_code ?? '',
      listedMarket: r.listed_market ?? '',
      nation: (r.nation === 'US' ? 'US' : 'KR') as Nation,
      marketCap: r.market_cap,
    }));

    return NextResponse.json({
      results: resultsWithCap,
      nation,
      sort,
      limit,
      offset,
      hasMore: rows.length === limit,
    });
  } catch (error) {
    if (error instanceof D1Error) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 },
      );
    }
    throw error;
  }
}
