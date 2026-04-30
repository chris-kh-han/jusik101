/**
 * Cloudflare D1 클라이언트
 *
 * 사용 환경: Cloudflare Pages Functions (Edge Runtime)
 *
 * D1은 Pages 환경에서 binding으로 주입됩니다 (wrangler.toml의 [[d1_databases]] 설정).
 * Next.js App Router에서는 Cloudflare context로부터 env를 받아 사용합니다.
 *
 * 참고:
 * - https://developers.cloudflare.com/d1/build-with-d1/d1-client-api/
 * - https://github.com/cloudflare/next-on-pages
 */

import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from '@cloudflare/workers-types';

/** Cloudflare Pages 환경 변수 + 바인딩 타입 */
export interface CloudflareEnv {
  /** D1 데이터베이스 (wrangler.toml의 binding = "DB") */
  readonly DB: D1Database;
  /** OpenDART API 키 */
  readonly DART_API_KEY?: string;
  /** Cron 인증 시크릿 */
  readonly CRON_SECRET?: string;
}

/** D1 전용 에러 (DartApiError 패턴 참조) */
export class D1Error extends Error {
  constructor(
    public readonly code:
      | 'NO_BINDING'
      | 'QUERY_FAILED'
      | 'BATCH_FAILED'
      | 'NOT_FOUND',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`D1 에러 [${code}]: ${message}`);
    this.name = 'D1Error';
  }
}

/**
 * Cloudflare Pages context에서 D1 binding을 가져옵니다.
 *
 * Next.js App Router (Edge runtime)에서:
 * - 프로덕션: getRequestContext() 통해 env 접근
 * - 로컬 개발 (wrangler pages dev): 동일한 방식으로 동작
 */
export async function getD1(): Promise<D1Database> {
  // @cloudflare/next-on-pages의 getRequestContext 사용
  // (dynamic import로 Next.js dev 환경에서 깨지지 않게 처리)
  try {
    const { getRequestContext } = await import('@cloudflare/next-on-pages');
    // getRequestContext 제네릭은 Record<string, unknown> 제약이 있어서
    // raw 호출 후 우리 타입으로 단언
    const context = getRequestContext();
    const env = context.env as unknown as CloudflareEnv;
    if (!env.DB) {
      throw new D1Error(
        'NO_BINDING',
        'D1 binding "DB"이(가) 설정되지 않았습니다.',
      );
    }
    return env.DB;
  } catch (error) {
    if (error instanceof D1Error) throw error;
    throw new D1Error(
      'NO_BINDING',
      'Cloudflare Pages context를 가져올 수 없습니다. wrangler pages dev 또는 배포 환경에서만 동작합니다.',
      error,
    );
  }
}

/**
 * D1에서 단일 쿼리 실행 (SELECT)
 *
 * 항상 prepared statement 사용 → SQL Injection 방지
 *
 * @example
 * const rows = await d1Query<Company>(
 *   db,
 *   'SELECT * FROM companies WHERE corp_name LIKE ?',
 *   [`%${query}%`]
 * );
 */
export async function d1Query<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: readonly (string | number | null)[] = [],
): Promise<readonly T[]> {
  try {
    const stmt = db.prepare(sql).bind(...params);
    const result = await stmt.all<T>();
    if (!result.success) {
      throw new D1Error('QUERY_FAILED', `쿼리 실행 실패: ${sql.slice(0, 80)}`);
    }
    return result.results ?? [];
  } catch (error) {
    if (error instanceof D1Error) throw error;
    throw new D1Error(
      'QUERY_FAILED',
      `쿼리 실행 중 예외: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
      error,
    );
  }
}

/**
 * D1에서 단일 행 조회 (없으면 null)
 *
 * @example
 * const company = await d1QueryFirst<Company>(
 *   db,
 *   'SELECT * FROM companies WHERE corp_code = ?',
 *   [corpCode]
 * );
 */
export async function d1QueryFirst<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: readonly (string | number | null)[] = [],
): Promise<T | null> {
  try {
    const stmt = db.prepare(sql).bind(...params);
    const result = await stmt.first<T>();
    return result ?? null;
  } catch (error) {
    throw new D1Error(
      'QUERY_FAILED',
      `단일 행 조회 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
      error,
    );
  }
}

/**
 * D1 배치 실행 (트랜잭션)
 *
 * 여러 statement를 atomic하게 실행. 한 개라도 실패하면 전체 롤백.
 *
 * @example
 * const stmts = companies.map(c =>
 *   db.prepare('INSERT INTO companies ... VALUES (?, ?, ?, ?, ?, ?)')
 *     .bind(c.corpCode, c.corpName, ...)
 * );
 * await d1Batch(db, stmts);
 */
export async function d1Batch(
  db: D1Database,
  statements: readonly D1PreparedStatement[],
): Promise<readonly D1Result[]> {
  if (statements.length === 0) return [];
  try {
    const results = await db.batch([...statements]);
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      throw new D1Error(
        'BATCH_FAILED',
        `배치 실행 실패: ${failed.length}개 statement 실패`,
      );
    }
    return results;
  } catch (error) {
    if (error instanceof D1Error) throw error;
    throw new D1Error(
      'BATCH_FAILED',
      `배치 실행 중 예외: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
      error,
    );
  }
}

/**
 * 데이터 일괄 삽입 헬퍼
 *
 * 큰 배열을 N개씩 청크로 나눠 batch 실행 (D1 단일 batch 한도 회피).
 * D1 단일 batch는 보통 1,000개 statement까지 안전.
 */
export async function d1BulkInsert<
  T extends Record<string, string | number | null>,
>(
  db: D1Database,
  table: string,
  rows: readonly T[],
  chunkSize: number = 500,
): Promise<{ inserted: number; chunks: number }> {
  if (rows.length === 0) return { inserted: 0, chunks: 0 };

  const columns = Object.keys(rows[0] as Record<string, unknown>);
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

  let totalInserted = 0;
  let chunkCount = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const stmts = chunk.map((row) =>
      db.prepare(sql).bind(...columns.map((c) => row[c])),
    );
    await d1Batch(db, stmts);
    totalInserted += chunk.length;
    chunkCount += 1;
  }

  return { inserted: totalInserted, chunks: chunkCount };
}
