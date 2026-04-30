/** DART API 공통 응답 구조 */
export interface DartApiResponse<T> {
  readonly status: string;
  readonly message: string;
  readonly list?: readonly T[];
}

/** 기업 기본 정보 */
export interface Company {
  readonly corpCode: string;
  readonly corpName: string;
  readonly stockCode: string;
  readonly industry: string;
  readonly listedMarket: 'KOSPI' | 'KOSDAQ' | '';
}

/** DART 재무제표 원본 항목 */
export interface DartFinancialItem {
  readonly rcept_no: string;
  readonly bsns_year: string;
  readonly corp_code: string;
  readonly stock_code: string;
  readonly reprt_code: string;
  readonly fs_div: 'CFS' | 'OFS';
  readonly fs_nm: string;
  readonly sj_div: string;
  readonly sj_nm: string;
  readonly account_id: string;
  readonly account_nm: string;
  readonly account_detail: string;
  readonly thstrm_nm: string;
  readonly thstrm_amount: string;
  readonly frmtrm_nm: string;
  readonly frmtrm_amount: string;
  readonly bfefrmtrm_nm: string;
  readonly bfefrmtrm_amount: string;
  readonly ord: string;
}

/** 정규화된 재무제표 항목 */
export interface FinancialItem {
  readonly accountName: string;
  readonly currentAmount: number;
  readonly previousAmount: number;
  readonly beforePreviousAmount: number;
  readonly statementType: StatementType;
  readonly order: number;
}

/** 재무제표 종류 */
export type StatementType = 'BS' | 'IS' | 'CF' | 'SCE';

/** 재무제표 종류 한글 매핑 */
export const STATEMENT_TYPE_LABELS: Record<StatementType, string> = {
  BS: '재무상태표',
  IS: '손익계산서',
  CF: '현금흐름표',
  SCE: '자본변동표',
} as const;

/** 그룹화된 재무제표 */
export interface GroupedStatements {
  readonly balanceSheet: readonly FinancialItem[];
  readonly incomeStatement: readonly FinancialItem[];
  readonly cashFlow: readonly FinancialItem[];
}

/** 재무비율 */
export interface FinancialRatios {
  readonly operatingMargin: number;
  readonly netMargin: number;
  readonly roe: number;
  readonly debtRatio: number;
  readonly currentRatio: number;
  readonly revenueGrowth: number;
}

/** 재무 건강 점수 */
export interface HealthScore {
  readonly score: number;
  readonly grade: 'A' | 'B' | 'C' | 'D' | 'F';
  readonly summary: string;
  readonly details: readonly HealthDetail[];
}

export interface HealthDetail {
  readonly category: string;
  readonly label: string;
  readonly value: number;
  readonly maxValue: number;
  readonly status: 'good' | 'normal' | 'warning' | 'danger';
}

/** 연도별 추세 데이터 */
export interface TrendDataPoint {
  readonly year: number;
  readonly revenue: number;
  readonly operatingIncome: number;
  readonly netIncome: number;
  readonly totalAssets: number;
  readonly totalLiabilities: number;
  readonly totalEquity: number;
}

/** 계정과목 매핑 정보 */
export interface AccountMapping {
  readonly simpleName: string;
  readonly description: string;
  readonly category: AccountCategory;
}

export type AccountCategory =
  | '자산'
  | '부채'
  | '자본'
  | '매출'
  | '비용'
  | '이익'
  | '현금흐름';

/** 보고서 구분 코드 */
export type ReportCode = '11011' | '11012' | '11013' | '11014';

export const REPORT_CODE_LABELS: Record<ReportCode, string> = {
  '11011': '사업보고서',
  '11012': '반기보고서',
  '11013': '1분기보고서',
  '11014': '3분기보고서',
} as const;

/** 연결/개별 구분 */
export type FsDiv = 'CFS' | 'OFS';

/** 검색 결과 */
export interface SearchResult {
  readonly corpCode: string;
  readonly corpName: string;
  readonly stockCode: string;
  readonly listedMarket: string;
}

/** 한국 통화 포맷 옵션 */
export interface CurrencyFormatOptions {
  readonly showSign?: boolean;
  readonly unit?: '원' | '만원' | '억원' | '조원';
}

/** 기업 대시보드에 필요한 종합 데이터 */
export interface CompanyDashboardData {
  readonly company: Company;
  readonly statements: GroupedStatements;
  readonly ratios: FinancialRatios;
  readonly healthScore: HealthScore;
  readonly trends: readonly TrendDataPoint[];
  readonly year: number;
  readonly reportCode: ReportCode;
}

/** 뷰 모드 */
export type ViewMode = 'easy' | 'detail';
