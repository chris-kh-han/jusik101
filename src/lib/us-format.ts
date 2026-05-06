/**
 * 미국 통화/숫자 포맷 헬퍼
 *
 * 한국 financial-utils.ts의 formatKoreanCurrency 등에 대응.
 * 토스 스타일: 시총은 "$3.5T", 매출은 "$95.4B", 분기 dps는 "$0.26"
 */

/**
 * 큰 금액을 compact 형식 ($3.5T / $95.4B / $1.2M).
 *
 * @param value USD 금액
 * @param decimals 소수점 (디폴트 1)
 */
export function formatUsdCompact(
  value: number | null | undefined,
  decimals: number = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }

  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1_000_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000_000).toFixed(decimals)}T`;
  }
  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(decimals)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(decimals)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(decimals)}K`;
  }
  return `${sign}$${abs.toFixed(decimals)}`;
}

/** 정밀한 USD 표시 ($0.26, $1.92 등) */
export function formatUsd(
  value: number | null | undefined,
  decimals: number = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(decimals)}`;
}

/** 시가총액 전용 ("3.5T" 단위 + $) */
export function formatMarketCap(value: number | null | undefined): string {
  return formatUsdCompact(value, 2);
}

/** 영문/숫자 회사명을 그대로 표시 */
export function formatCompanyName(name: string): string {
  return name.trim();
}

/** 'YYYY-MM-DD' → 'Mar 28, 2025' (영어 표기) */
export function formatDateUs(iso: string): string {
  if (iso.length < 10) return iso;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const y = iso.slice(0, 4);
  const m = parseInt(iso.slice(5, 7), 10);
  const d = parseInt(iso.slice(8, 10), 10);
  if (!m || !d) return iso;
  return `${months[m - 1]} ${d}, ${y}`;
}
