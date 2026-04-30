import type {
  FinancialItem,
  FinancialRatios,
  HealthDetail,
  HealthScore,
  CurrencyFormatOptions,
} from '@/types/financial';
import { findAccountAmount, findPreviousAmount } from './data-transform';

/**
 * 재무비율 계산
 */
export function calculateRatios(
  items: readonly FinancialItem[],
): FinancialRatios {
  const revenue = findAccountAmount(items, '매출액');
  const operatingIncome = findAccountAmount(items, '영업이익');
  const netIncome = findAccountAmount(items, '당기순이익');
  const totalEquity = findAccountAmount(items, '자본총계');
  const totalLiabilities = findAccountAmount(items, '부채총계');
  const currentAssets = findAccountAmount(items, '유동자산');
  const currentLiabilities = findAccountAmount(items, '유동부채');
  const prevRevenue = findPreviousAmount(items, '매출액');

  return {
    operatingMargin: safeDivide(operatingIncome, revenue) * 100,
    netMargin: safeDivide(netIncome, revenue) * 100,
    roe: safeDivide(netIncome, totalEquity) * 100,
    debtRatio: safeDivide(totalLiabilities, totalEquity) * 100,
    currentRatio: safeDivide(currentAssets, currentLiabilities) * 100,
    revenueGrowth:
      safeDivide(revenue - prevRevenue, Math.abs(prevRevenue)) * 100,
  };
}

/**
 * 안전한 나눗셈 (0으로 나누기 방지)
 */
function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * 재무 건강 점수 계산 (0~100)
 */
export function getHealthScore(ratios: FinancialRatios): HealthScore {
  const details: HealthDetail[] = [
    evaluateProfitability(ratios),
    evaluateStability(ratios),
    evaluateGrowth(ratios),
    evaluateLiquidity(ratios),
    evaluateEfficiency(ratios),
  ];

  const score = Math.round(
    details.reduce((sum, d) => sum + d.value, 0) / details.length,
  );

  const grade = scoreToGrade(score);
  const summary = generateSummary(grade, ratios);

  return { score, grade, summary, details };
}

function evaluateProfitability(ratios: FinancialRatios): HealthDetail {
  const value = clampScore(
    ratios.operatingMargin > 0
      ? Math.min(ratios.operatingMargin * 3, 100)
      : Math.max(ratios.operatingMargin * 2, 0),
  );
  return {
    category: 'profitability',
    label: '수익성',
    value,
    maxValue: 100,
    status:
      value >= 70
        ? 'good'
        : value >= 40
          ? 'normal'
          : value >= 20
            ? 'warning'
            : 'danger',
  };
}

function evaluateStability(ratios: FinancialRatios): HealthDetail {
  const value = clampScore(
    ratios.debtRatio <= 100
      ? 80 + (100 - ratios.debtRatio) * 0.2
      : Math.max(100 - (ratios.debtRatio - 100) * 0.3, 0),
  );
  return {
    category: 'stability',
    label: '안정성',
    value,
    maxValue: 100,
    status:
      value >= 70
        ? 'good'
        : value >= 40
          ? 'normal'
          : value >= 20
            ? 'warning'
            : 'danger',
  };
}

function evaluateGrowth(ratios: FinancialRatios): HealthDetail {
  const value = clampScore(
    ratios.revenueGrowth > 0
      ? Math.min(50 + ratios.revenueGrowth * 2, 100)
      : Math.max(50 + ratios.revenueGrowth, 0),
  );
  return {
    category: 'growth',
    label: '성장성',
    value,
    maxValue: 100,
    status:
      value >= 70
        ? 'good'
        : value >= 40
          ? 'normal'
          : value >= 20
            ? 'warning'
            : 'danger',
  };
}

function evaluateLiquidity(ratios: FinancialRatios): HealthDetail {
  const value = clampScore(
    ratios.currentRatio >= 200
      ? 100
      : ratios.currentRatio >= 100
        ? 60 + (ratios.currentRatio - 100) * 0.4
        : ratios.currentRatio * 0.6,
  );
  return {
    category: 'liquidity',
    label: '유동성',
    value,
    maxValue: 100,
    status:
      value >= 70
        ? 'good'
        : value >= 40
          ? 'normal'
          : value >= 20
            ? 'warning'
            : 'danger',
  };
}

function evaluateEfficiency(ratios: FinancialRatios): HealthDetail {
  const value = clampScore(
    ratios.roe > 0
      ? Math.min(ratios.roe * 4, 100)
      : Math.max(50 + ratios.roe * 2, 0),
  );
  return {
    category: 'efficiency',
    label: '효율성',
    value,
    maxValue: 100,
    status:
      value >= 70
        ? 'good'
        : value >= 40
          ? 'normal'
          : value >= 20
            ? 'warning'
            : 'danger',
  };
}

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function scoreToGrade(score: number): HealthScore['grade'] {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  if (score >= 20) return 'D';
  return 'F';
}

function generateSummary(
  grade: HealthScore['grade'],
  ratios: FinancialRatios,
): string {
  const parts: string[] = [];

  switch (grade) {
    case 'A':
      parts.push('이 회사는 전반적으로 재무 상태가 매우 양호합니다.');
      break;
    case 'B':
      parts.push('이 회사는 재무 상태가 양호한 편입니다.');
      break;
    case 'C':
      parts.push('이 회사는 재무 상태가 보통 수준입니다.');
      break;
    case 'D':
      parts.push('이 회사는 재무 상태에 주의가 필요합니다.');
      break;
    case 'F':
      parts.push('이 회사는 재무 상태가 좋지 않습니다.');
      break;
  }

  if (ratios.operatingMargin > 15) {
    parts.push('본업에서 높은 수익을 내고 있어요.');
  } else if (ratios.operatingMargin < 0) {
    parts.push('본업에서 적자를 내고 있어 주의가 필요해요.');
  }

  if (ratios.debtRatio > 200) {
    parts.push('부채가 자본보다 많아 재무 안정성이 낮아요.');
  } else if (ratios.debtRatio < 50) {
    parts.push('빚이 적어서 재무가 안정적이에요.');
  }

  if (ratios.revenueGrowth > 10) {
    parts.push('매출이 성장하고 있어요.');
  } else if (ratios.revenueGrowth < -10) {
    parts.push('매출이 감소하고 있어 주의가 필요해요.');
  }

  return parts.join(' ');
}

/**
 * 한국 통화 포맷 (예: "1,234억원", "1.2조원")
 */
export function formatKoreanCurrency(
  amount: number,
  options: CurrencyFormatOptions = {},
): string {
  const { showSign = false } = options;
  const sign = showSign && amount > 0 ? '+' : '';
  const absAmount = Math.abs(amount);

  if (absAmount >= 1_000_000_000_000) {
    const value = absAmount / 1_000_000_000_000;
    return `${amount < 0 ? '-' : sign}${formatNumber(value)}조원`;
  }

  if (absAmount >= 100_000_000) {
    const value = absAmount / 100_000_000;
    return `${amount < 0 ? '-' : sign}${formatNumber(value)}억원`;
  }

  if (absAmount >= 10_000) {
    const value = absAmount / 10_000;
    return `${amount < 0 ? '-' : sign}${formatNumber(value)}만원`;
  }

  return `${amount < 0 ? '-' : sign}${absAmount.toLocaleString('ko-KR')}원`;
}

function formatNumber(value: number): string {
  if (value >= 100) {
    return Math.round(value).toLocaleString('ko-KR');
  }
  if (value >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

/**
 * 증감률 계산 + 포맷
 */
export function formatChangeRate(
  current: number,
  previous: number,
): { rate: number; formatted: string; direction: 'up' | 'down' | 'flat' } {
  if (previous === 0) {
    return { rate: 0, formatted: '-', direction: 'flat' };
  }

  const rate = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(rate * 10) / 10;

  return {
    rate: rounded,
    formatted: `${rounded > 0 ? '+' : ''}${rounded}%`,
    direction: rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat',
  };
}

/**
 * 비율을 소수점 1자리 문자열로 포맷
 */
export function formatRatio(value: number): string {
  return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}
