import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { getCachedFinancials } from '@/lib/cache';
import { normalizeFinancialData, groupByStatement } from '@/lib/data-transform';
import { calculateRatios, getHealthScore } from '@/lib/financial-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { DartApiError } from '@/lib/dart-api';
import type { ReportCode, FsDiv } from '@/types/financial';

// Cloudflare Pages 호환: Edge Runtime 명시
export const runtime = 'edge';

const currentYear = new Date().getFullYear();

const financialSchema = z.object({
  corpCode: z.string().regex(/^\d{8}$/, '기업 코드는 8자리 숫자여야 합니다'),
  year: z.coerce
    .number()
    .int()
    .min(2015, '2015년 이후 데이터만 조회 가능합니다')
    .max(currentYear, '미래 연도는 조회할 수 없습니다'),
  reportCode: z
    .enum(['11011', '11012', '11013', '11014'])
    .optional()
    .default('11011'),
  fsDiv: z.enum(['CFS', 'OFS']).optional().default('CFS'),
});

export async function GET(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const { allowed, retryAfterMs } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = financialSchema.safeParse({
    corpCode: searchParams.get('corpCode'),
    year: searchParams.get('year'),
    reportCode: searchParams.get('reportCode'),
    fsDiv: searchParams.get('fsDiv'),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '잘못된 요청입니다' },
      { status: 400 },
    );
  }

  const { corpCode, year, reportCode, fsDiv } = parsed.data;

  try {
    const rawData = await getCachedFinancials(
      corpCode,
      year,
      reportCode as ReportCode,
      fsDiv as FsDiv,
    );

    const normalized = normalizeFinancialData(rawData);
    const grouped = groupByStatement(normalized);
    const ratios = calculateRatios(normalized);
    const healthScore = getHealthScore(ratios);

    return NextResponse.json({
      statements: grouped,
      ratios,
      healthScore,
      year,
      corpCode,
    });
  } catch (error) {
    if (error instanceof DartApiError) {
      if (error.code === '013') {
        return NextResponse.json(
          { error: '해당 기업의 재무제표 데이터가 없습니다.' },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: `DART API 오류: ${error.message}` },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { error: '재무제표 데이터를 불러오는 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
