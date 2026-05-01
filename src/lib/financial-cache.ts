/**
 * Financial Cache (D1 backed)
 *
 * DART API 응답을 D1 financial_cache 테이블에 저장/조회.
 * 첫 방문에 17회 호출 → 두 번째 방문부터 0회 호출.
 *
 * 사용:
 *   const cached = await getCachedDartResponse<unknown[]>(db, key);
 *   if (cached && isCacheFresh(cached.fetchedAt, ttlDays)) return cached.data;
 *   const fresh = await dartApi.fetch(...);
 *   await saveDartResponse(db, key, fresh);
 */

import type { D1Database } from '@cloudflare/workers-types';
import { d1QueryFirst, d1Query, D1Error } from './d1-client';

/** DART 엔드포인트 */
export type DartEndpoint =
  | 'fnlttSinglAcntAll'
  | 'fnlttSinglIndx'
  | 'alotMatter'
  | 'hyslrSttus'
  | 'company';

/** 캐시 키 */
export interface CacheKey {
  readonly corpCode: string;
  readonly bsnsYear: number;
  readonly reprtCode: string; // '11011' / '11012' / '11013' / '11014'
  readonly fsDiv?: string; // 'CFS' / 'OFS' / '-' (default '-')
  readonly endpoint: DartEndpoint;
  readonly idxClCode?: string; // 'M210000' 등 / '-' (default '-')
}

/** 캐시 row 타입 */
interface FinancialCacheRow {
  readonly data: string;
  readonly fetched_at: number;
}

export interface CachedResponse<T> {
  readonly data: T;
  readonly fetchedAt: number;
}

/** 보고서 코드별 TTL (일) */
const TTL_BY_REPORT: Record<string, number> = {
  '11011': 365, // 사업보고서 (확정 데이터)
  '11012': 90, // 반기보고서
  '11013': 90, // 1분기보고서
  '11014': 90, // 3분기보고서
};

/** 엔드포인트별 TTL 오버라이드 (일) */
const TTL_BY_ENDPOINT: Partial<Record<DartEndpoint, number>> = {
  fnlttSinglIndx: 30, // 재무비율은 짧게
  alotMatter: 365,
  hyslrSttus: 365,
  company: 30,
};

/** TTL 결정 (엔드포인트 우선, 없으면 보고서 코드, 없으면 90일) */
export function ttlForKey(key: CacheKey): number {
  return TTL_BY_ENDPOINT[key.endpoint] ?? TTL_BY_REPORT[key.reprtCode] ?? 90;
}

/** 캐시가 신선한지 확인 */
export function isCacheFresh(fetchedAtMs: number, ttlDays: number): boolean {
  const ageMs = Date.now() - fetchedAtMs;
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  return ageMs < ttlMs;
}

/** 키 정규화 (NULL 대신 '-') */
function normalizeKey(key: CacheKey) {
  return {
    corpCode: key.corpCode,
    bsnsYear: key.bsnsYear,
    reprtCode: key.reprtCode,
    fsDiv: key.fsDiv ?? '-',
    endpoint: key.endpoint,
    idxClCode: key.idxClCode ?? '-',
  };
}

/**
 * D1 캐시에서 DART 응답 조회
 *
 * @returns CachedResponse<T> | null (없거나 stale이면 null)
 */
export async function getCachedDartResponse<T>(
  db: D1Database,
  key: CacheKey,
): Promise<CachedResponse<T> | null> {
  const k = normalizeKey(key);
  try {
    const row = await d1QueryFirst<FinancialCacheRow>(
      db,
      `SELECT data, fetched_at FROM financial_cache
       WHERE corp_code = ? AND bsns_year = ? AND reprt_code = ?
         AND fs_div = ? AND endpoint = ? AND idx_cl_code = ?`,
      [k.corpCode, k.bsnsYear, k.reprtCode, k.fsDiv, k.endpoint, k.idxClCode],
    );

    if (!row) return null;

    if (!isCacheFresh(row.fetched_at, ttlForKey(key))) {
      // stale 캐시는 null 반환 (호출자가 새로 fetch하도록)
      return null;
    }

    return {
      data: JSON.parse(row.data) as T,
      fetchedAt: row.fetched_at,
    };
  } catch (error) {
    if (error instanceof D1Error) {
      // D1 binding 없거나 쿼리 실패 → 캐시 없음으로 처리 (fallback)
      return null;
    }
    throw error;
  }
}

/**
 * DART 응답을 D1 캐시에 저장 (UPSERT)
 *
 * 실패해도 throw 안 함 — 캐시 저장 실패는 사용자 경험에 영향 X
 */
export async function saveDartResponse<T>(
  db: D1Database,
  key: CacheKey,
  data: T,
): Promise<void> {
  const k = normalizeKey(key);
  try {
    await d1Query(
      db,
      `INSERT OR REPLACE INTO financial_cache
       (corp_code, bsns_year, reprt_code, fs_div, endpoint, idx_cl_code, data, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        k.corpCode,
        k.bsnsYear,
        k.reprtCode,
        k.fsDiv,
        k.endpoint,
        k.idxClCode,
        JSON.stringify(data),
        Date.now(),
      ],
    );
  } catch (error) {
    // 캐시 저장 실패는 silent (D1 binding 없거나 일시적 문제)
    if (!(error instanceof D1Error)) throw error;
    console.warn('[financial-cache] save failed:', error.message);
  }
}

/**
 * Cache-or-fetch 패턴 헬퍼
 *
 * @example
 * const data = await cacheOrFetch(db, key, async () => {
 *   return await fetchFinancialStatements(...);
 * });
 */
export async function cacheOrFetch<T>(
  db: D1Database | null,
  key: CacheKey,
  fetcher: () => Promise<T>,
): Promise<T> {
  // D1 사용 가능하면 캐시 먼저 시도
  if (db) {
    const cached = await getCachedDartResponse<T>(db, key);
    if (cached) return cached.data;
  }

  const fresh = await fetcher();

  if (db) {
    // 비동기로 캐시 저장 (응답 지연 최소화 — 단, Cloudflare는 promise를 await해야 실행됨)
    await saveDartResponse(db, key, fresh);
  }

  return fresh;
}
