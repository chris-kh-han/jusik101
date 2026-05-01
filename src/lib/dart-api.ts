import type {
  Company,
  DartApiResponse,
  DartFinancialItem,
  FsDiv,
  ReportCode,
} from '@/types/financial';

const BASE_URL = 'https://opendart.fss.or.kr/api';
const TIMEOUT_MS = 10_000;

function getApiKey(): string {
  const key = process.env.DART_API_KEY;
  if (!key) {
    throw new Error(
      'DART_API_KEY 환경변수가 설정되지 않았습니다. .env.local 파일을 확인하세요.',
    );
  }
  return key;
}

/**
 * DART API fetch 래퍼 (타임아웃 + 에러 핸들링)
 */
async function dartFetch<T>(
  endpoint: string,
  params: Record<string, string>,
): Promise<DartApiResponse<T>> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  url.searchParams.set('crtfc_key', getApiKey());

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Cloudflare Workers fetch는 표준 cache 옵션 미지원 — 캐시는 페이지 레벨 revalidate(24h)에 의존.
    const response = await fetch(url.toString(), {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `DART API 요청 실패: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as DartApiResponse<T>;

    if (data.status !== '000') {
      throw new DartApiError(data.status, data.message);
    }

    console.log(data);

    return data;
  } catch (error) {
    if (error instanceof DartApiError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('DART API 요청 시간 초과 (10초)');
    }
    throw new Error(
      `DART API 연결 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/** DART API 전용 에러 */
export class DartApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`DART API 에러 [${code}]: ${message}`);
    this.name = 'DartApiError';
  }
}

/** DART API 상태 코드 의미 */
export const DART_STATUS_MESSAGES: Readonly<Record<string, string>> = {
  '000': '정상',
  '010': '등록되지 않은 키입니다',
  '011': '사용할 수 없는 키입니다',
  '012': '접근할 수 없는 IP입니다',
  '013': '조회된 데이터가 없습니다',
  '014': '파일이 존재하지 않습니다',
  '020': '요청 제한 초과',
  '100': '필수 인자가 누락되었습니다',
  '800': '원천 시스템 오류입니다',
  '900': '정의되지 않은 오류입니다',
};

/**
 * 기업 개황 정보 조회
 */
export async function fetchCompanyInfo(
  corpCode: string,
): Promise<Company | null> {
  try {
    const response = await fetch(
      `${BASE_URL}/company.json?crtfc_key=${getApiKey()}&corp_code=${corpCode}`,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      status?: string;
      corp_code?: string;
      corp_name?: string;
      stock_code?: string;
      induty_code?: string;
      corp_cls?: string;
    };

    if (data.status !== '000') {
      return null;
    }

    return {
      corpCode: data.corp_code ?? '',
      corpName: data.corp_name ?? '',
      stockCode: data.stock_code ?? '',
      industry: data.induty_code ?? '',
      listedMarket: parseMarket(data.corp_cls ?? ''),
    };
  } catch {
    return null;
  }
}

/** OpenDART /company.json 전체 raw 응답 */
export interface DartCompanyDetail {
  readonly corp_code: string;
  readonly corp_name: string;
  readonly corp_name_eng?: string;
  readonly stock_name?: string;
  readonly stock_code?: string;
  readonly ceo_nm?: string;
  readonly corp_cls?: string;
  readonly jurir_no?: string;
  readonly bizr_no?: string;
  readonly adres?: string;
  readonly hm_url?: string;
  readonly ir_url?: string;
  readonly phn_no?: string;
  readonly fax_no?: string;
  readonly induty_code?: string;
  readonly est_dt?: string; // YYYYMMDD
  readonly acc_mt?: string; // 결산월 (예: '12')
}

/**
 * 기업 개황 전체 raw 데이터 조회 (CEO, 주소, 홈페이지 등 포함)
 */
export async function fetchCompanyDetail(
  corpCode: string,
): Promise<DartCompanyDetail | null> {
  try {
    const response = await fetch(
      `${BASE_URL}/company.json?crtfc_key=${getApiKey()}&corp_code=${corpCode}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!response.ok) return null;

    const data = (await response.json()) as DartCompanyDetail & {
      status?: string;
    };
    if (data.status !== '000') return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * 단일회사 전체 재무제표 조회
 */
export async function fetchFinancialStatements(
  corpCode: string,
  year: number,
  reportCode: ReportCode = '11011',
  fsDiv: FsDiv = 'CFS',
): Promise<readonly DartFinancialItem[]> {
  const data = await dartFetch<DartFinancialItem>('fnlttSinglAcntAll.json', {
    corp_code: corpCode,
    bsns_year: String(year),
    reprt_code: reportCode,
    fs_div: fsDiv,
  });

  return data.list ?? [];
}

/**
 * 재무비율 카테고리 코드
 *   M210000: 수익성지표 (PER, ROE, 매출총이익률 등)
 *   M220000: 안정성지표 (부채비율, 유동비율, 이자보상비율 등)
 *   M230000: 성장성지표 (매출증가율, 영업이익증가율 등)
 *   M240000: 활동성지표 (회전율 등 + 배당성향)
 */
export type IndexCategoryCode = 'M210000' | 'M220000' | 'M230000' | 'M240000';

export const INDEX_CATEGORIES: readonly IndexCategoryCode[] = [
  'M210000',
  'M220000',
  'M230000',
  'M240000',
];

/** OpenDART 재무비율 응답 행 */
export interface DartFinancialIndex {
  readonly idx_cl_code: string;
  readonly idx_cl_nm: string;
  readonly idx_code: string;
  readonly idx_nm: string;
  readonly idx_val?: string;
  readonly stlm_dt: string;
}

/**
 * 단일회사 재무비율 조회 (한 카테고리)
 *
 * @param idxClCode 재무비율 카테고리 코드 (M210000~M240000)
 * @example
 *   const profitability = await fetchFinancialIndex(corp, 2025, '11011', 'M210000');
 *   // ROE, 순이익률, 매출총이익률 등
 */
export async function fetchFinancialIndex(
  corpCode: string,
  year: number,
  reportCode: ReportCode = '11011',
  idxClCode: IndexCategoryCode = 'M210000',
): Promise<readonly DartFinancialIndex[]> {
  const data = await dartFetch<DartFinancialIndex>('fnlttSinglIndx.json', {
    corp_code: corpCode,
    bsns_year: String(year),
    reprt_code: reportCode,
    idx_cl_code: idxClCode,
  });
  return data.list ?? [];
}

/** OpenDART 배당사항 응답 행 */
export interface DartDividendItem {
  readonly se: string; // '주당 현금배당금(원)' 등
  readonly stock_knd?: string; // '보통주' / '우선주'
  readonly thstrm: string; // 당기 (e.g. '1,446')
  readonly frmtrm: string; // 전기
  readonly lwfr: string; // 전전기
  readonly stlm_dt: string;
}

/** 단일회사 배당사항 조회 */
export async function fetchDividend(
  corpCode: string,
  year: number,
  reportCode: ReportCode = '11011',
): Promise<readonly DartDividendItem[]> {
  try {
    const data = await dartFetch<DartDividendItem>('alotMatter.json', {
      corp_code: corpCode,
      bsns_year: String(year),
      reprt_code: reportCode,
    });
    return data.list ?? [];
  } catch (error) {
    // 배당 데이터 없는 회사 다수 — 013 에러는 정상
    if (error instanceof DartApiError && error.code === '013') {
      return [];
    }
    throw error;
  }
}

/**
 * 단일회사 주요 계정 조회 (요약본)
 */
export async function fetchKeyAccounts(
  corpCode: string,
  year: number,
  reportCode: ReportCode = '11011',
  fsDiv: FsDiv = 'CFS',
): Promise<readonly DartFinancialItem[]> {
  const data = await dartFetch<DartFinancialItem>('fnlttSinglAcnt.json', {
    corp_code: corpCode,
    bsns_year: String(year),
    reprt_code: reportCode,
    fs_div: fsDiv,
  });

  return data.list ?? [];
}

/**
 * DART corp_cls → listedMarket 매핑
 */
function parseMarket(corpCls: string): Company['listedMarket'] {
  switch (corpCls) {
    case 'Y':
      return 'KOSPI';
    case 'K':
      return 'KOSDAQ';
    default:
      return '';
  }
}
