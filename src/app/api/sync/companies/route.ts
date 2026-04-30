/**
 * POST /api/sync/companies
 *
 * OpenDART corpCode.xml을 다운로드해서 D1 companies 테이블에 동기화합니다.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 * 호출: GitHub Actions cron (주 1회) 또는 수동
 *
 * 동작:
 *   1. CRON_SECRET 검증
 *   2. https://opendart.fss.or.kr/api/corpCode.xml ZIP 다운로드
 *   3. JSZip으로 압축 해제 → CORPCODE.xml 추출
 *   4. fast-xml-parser로 파싱
 *   5. 상장사 필터링 (stock_code 비어있지 않은 것)
 *   6. Zod 검증
 *   7. D1 companies 테이블에 UPSERT (배치)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod/v4';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { getD1, d1BulkInsert, D1Error } from '@/lib/d1-client';

// Cloudflare Pages 호환: Edge Runtime 명시
export const runtime = 'edge';

const CORP_CODE_URL = 'https://opendart.fss.or.kr/api/corpCode.xml';
const SYNC_TIMEOUT_MS = 60_000; // 60초 (1MB ZIP 다운로드 + 파싱 여유)

/** OpenDART corpCode.xml의 단일 항목 스키마 */
const corpCodeSchema = z.object({
  corp_code: z.string().regex(/^\d{8}$/, '8자리 숫자여야 함'),
  corp_name: z.string().min(1).max(200),
  stock_code: z.string(),
  modify_date: z.string().optional().default(''),
});

type CorpCode = z.infer<typeof corpCodeSchema>;

/** D1 companies 테이블 행 (snake_case) */
interface CompanyRow extends Record<string, string | number | null> {
  corp_code: string;
  corp_name: string;
  stock_code: string | null;
  listed_market: string;
  modify_date: string;
  updated_at: number;
}

/**
 * POST 핸들러
 */
export async function POST(request: Request) {
  // 1. 인증 검증
  const authError = verifyAuth(request);
  if (authError) return authError;

  // 2. DART_API_KEY 확인
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'DART_API_KEY가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  try {
    // 3. corpCode.xml ZIP 다운로드
    const xmlText = await downloadCorpCodeXml(apiKey);

    // 4. XML 파싱 → 검증 → 상장사 필터링
    const corpCodes = parseCorpCodeXml(xmlText);
    const listed = corpCodes.filter((c) => c.stock_code.trim() !== '');

    // 5. D1 companies 테이블에 UPSERT
    const db = await getD1();
    const now = Date.now();
    const rows: CompanyRow[] = listed.map((c) => ({
      corp_code: c.corp_code,
      corp_name: c.corp_name,
      stock_code: c.stock_code || null,
      listed_market: inferMarket(c.stock_code),
      modify_date: c.modify_date,
      updated_at: now,
    }));

    const { inserted, chunks } = await d1BulkInsert(db, 'companies', rows, 500);

    return NextResponse.json({
      success: true,
      total: corpCodes.length,
      listed: listed.length,
      synced: inserted,
      chunks,
      syncedAt: new Date(now).toISOString(),
    });
  } catch (error) {
    console.error('[sync/companies] Error:', error);

    if (error instanceof D1Error) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      },
      { status: 500 },
    );
  }
}

/** Authorization 헤더 검증 */
function verifyAuth(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET이 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${cronSecret}`;

  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

/** OpenDART corpCode.xml ZIP 다운로드 + 압축 해제 */
async function downloadCorpCodeXml(apiKey: string): Promise<string> {
  const url = new URL(CORP_CODE_URL);
  url.searchParams.set('crtfc_key', apiKey);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `OpenDART corpCode 다운로드 실패: ${response.status} ${response.statusText}`,
    );
  }

  const buffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = zip.file('CORPCODE.xml');

  if (!xmlFile) {
    throw new Error('ZIP 안에 CORPCODE.xml이 없습니다.');
  }

  return xmlFile.async('string');
}

/** XML 파싱 + 검증 → CorpCode[] */
function parseCorpCodeXml(xmlText: string): CorpCode[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false, // 모든 값을 string으로 유지 (corp_code, stock_code 보존)
    trimValues: true,
  });

  const parsed = parser.parse(xmlText) as {
    result?: { list?: unknown };
  };

  const list = parsed.result?.list;
  if (!Array.isArray(list)) {
    throw new Error('XML 구조 이상: result.list가 배열이 아닙니다.');
  }

  // Zod로 각 항목 검증 (실패한 것은 로깅 후 스킵)
  const valid: CorpCode[] = [];
  let invalidCount = 0;

  for (const item of list) {
    const result = corpCodeSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalidCount += 1;
    }
  }

  if (invalidCount > 0) {
    console.warn(`[sync/companies] ${invalidCount}개 항목 검증 실패 (스킵됨)`);
  }

  return valid;
}

/**
 * 종목 코드로부터 상장 시장 추론
 *
 * DART corpCode.xml에는 시장 정보가 없어서 종목코드로 추론.
 * 보다 정확한 분류는 Step 11에서 KRX 데이터 결합 시 가능.
 */
function inferMarket(stockCode: string): string {
  // 대부분 KOSPI (000XXX, 005XXX 등)와 KOSDAQ (0XXXXX)는 6자리 수
  // 정확한 구분이 어려우므로 일단 'LISTED'로 분류
  // (검색에서는 corp_name 매칭이 메인이라 시장 구분 정확도가 크리티컬하지 않음)
  if (!stockCode || stockCode.length !== 6) return 'OTHER';
  return 'LISTED'; // 추후 KRX 데이터로 KOSPI/KOSDAQ 구분 가능
}
