import type {
  DartFinancialItem,
  FinancialItem,
  GroupedStatements,
  StatementType,
  TrendDataPoint,
} from '@/types/financial';
import { SJ_DIV_MAP } from '@/constants/accounts';

/**
 * 금액 문자열을 숫자로 파싱 (빈 값, 쉼표 처리)
 */
function parseAmount(value: string | undefined | null): number {
  if (!value || value === '') return 0;
  const cleaned = value.replace(/,/g, '').trim();
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * DART sj_div → StatementType 변환
 */
function toStatementType(sjDiv: string): StatementType | null {
  const mapped = SJ_DIV_MAP[sjDiv];
  if (!mapped) return null;
  return mapped as StatementType;
}

/**
 * DART 원본 데이터 → 정규화된 FinancialItem 배열
 */
export function normalizeFinancialData(
  items: readonly DartFinancialItem[],
): readonly FinancialItem[] {
  return items
    .map((item) => {
      const statementType = toStatementType(item.sj_div);
      if (!statementType) return null;

      return {
        accountName: item.account_nm,
        currentAmount: parseAmount(item.thstrm_amount),
        previousAmount: parseAmount(item.frmtrm_amount),
        beforePreviousAmount: parseAmount(item.bfefrmtrm_amount),
        statementType,
        order: Number(item.ord) || 0,
      } satisfies FinancialItem;
    })
    .filter((item): item is FinancialItem => item !== null);
}

/**
 * 정규화된 데이터를 재무제표 종류별로 그룹화
 */
export function groupByStatement(
  items: readonly FinancialItem[],
): GroupedStatements {
  return {
    balanceSheet: items
      .filter((i) => i.statementType === 'BS')
      .toSorted((a, b) => a.order - b.order),
    incomeStatement: items
      .filter((i) => i.statementType === 'IS')
      .toSorted((a, b) => a.order - b.order),
    cashFlow: items
      .filter((i) => i.statementType === 'CF')
      .toSorted((a, b) => a.order - b.order),
  };
}

/**
 * 특정 계정과목의 금액 추출
 */
export function findAccountAmount(
  items: readonly FinancialItem[],
  accountName: string,
): number {
  const item = items.find((i) => i.accountName === accountName);
  return item?.currentAmount ?? 0;
}

/**
 * 특정 계정과목의 전기 금액 추출
 */
export function findPreviousAmount(
  items: readonly FinancialItem[],
  accountName: string,
): number {
  const item = items.find((i) => i.accountName === accountName);
  return item?.previousAmount ?? 0;
}

/**
 * 연도별 추세 데이터 구성
 * 각 연도의 정규화된 데이터를 받아 TrendDataPoint 배열로 변환
 */
export function buildTrendDataPoint(
  year: number,
  items: readonly FinancialItem[],
): TrendDataPoint {
  return {
    year,
    revenue: findAccountAmount(items, '매출액'),
    operatingIncome: findAccountAmount(items, '영업이익'),
    netIncome: findAccountAmount(items, '당기순이익'),
    totalAssets: findAccountAmount(items, '자산총계'),
    totalLiabilities: findAccountAmount(items, '부채총계'),
    totalEquity: findAccountAmount(items, '자본총계'),
  };
}

/**
 * 초보자용 쉬운 모드 데이터 변환
 * 주요 항목만 필터링하여 반환
 */
const KEY_ACCOUNTS = new Set([
  '자산총계',
  '유동자산',
  '비유동자산',
  '부채총계',
  '유동부채',
  '비유동부채',
  '자본총계',
  '매출액',
  '매출원가',
  '매출총이익',
  '판매비와관리비',
  '영업이익',
  '당기순이익',
  '법인세비용',
  '영업활동현금흐름',
  '투자활동현금흐름',
  '재무활동현금흐름',
]);

export function filterKeyAccounts(
  items: readonly FinancialItem[],
): readonly FinancialItem[] {
  return items.filter((item) => KEY_ACCOUNTS.has(item.accountName));
}
