import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { searchCompanies } from '@/lib/company-search';
import { checkRateLimit } from '@/lib/rate-limit';

// Cloudflare Pages 호환: Edge Runtime 명시
export const runtime = 'edge';

const searchSchema = z.object({
  q: z
    .string()
    .min(1, '검색어를 입력해주세요')
    .max(50, '검색어가 너무 깁니다')
    .regex(/^[가-힣a-zA-Z0-9\s]+$/, '허용되지 않는 문자가 포함되어 있습니다'),
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
        headers: {
          'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
        },
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = searchSchema.safeParse({ q: searchParams.get('q') });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '잘못된 요청입니다' },
      { status: 400 },
    );
  }

  const results = searchCompanies(parsed.data.q);

  return NextResponse.json({ results });
}
