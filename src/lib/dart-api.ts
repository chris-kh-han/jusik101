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
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      next: { revalidate: 86400 },
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
        next: { revalidate: 86400 },
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
